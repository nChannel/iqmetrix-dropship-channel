function GetProductQuantityFromQuery(ncUtil, channelProfile, flowContext, payload, callback) {
  const nc = require("./util/ncUtils");
  const referenceLocations = ["productQuantityBusinessReferences"];
  const stub = new nc.Stub("GetProductQuantityFromQuery", referenceLocations, ...arguments);

  validateFunction()
    .then(getProductLists)
    .then(flattenProductLists)
    .then(getProductDetails)
    .then(filterVendors)
    .then(getAvailability)
    .then(keepModifiedItems)
    .then(buildResponseObject)
    .catch(handleError)
    .then(() => callback(stub.out))
    .catch(error => {
      logError(`The callback function threw an exception: ${error}`);
      setTimeout(() => {
        throw error;
      });
    });

  function logInfo(msg) {
    stub.log(msg, "info");
  }

  function logWarn(msg) {
    stub.log(msg, "warn");
  }

  function logError(msg) {
    stub.log(msg, "error");
  }

  async function validateFunction() {
    if (stub.messages.length === 0) {
      if (!nc.isNonEmptyArray(stub.channelProfile.channelSettingsValues.subscriptionLists)) {
        stub.messages.push(
          `The channelProfile.channelSettingsValues.subscriptionLists array is ${
            stub.channelProfile.channelSettingsValues.subscriptionLists == null ? "missing" : "invalid"
          }.`
        );
      }

      if (!nc.isObject(stub.payload.doc.modifiedDateRange)) {
        stub.messages.push(
          `The payload.doc.modifiedDateRange object is ${
            stub.payload.doc.modifiedDateRange == null ? "missing" : "invalid"
          }.`
        );
      } else {
        if (!nc.isNonEmptyString(stub.payload.doc.modifiedDateRange.startDateGMT)) {
          stub.messages.push(
            `The payload.doc.modifiedDateRange.startDateGMT string is ${
              stub.payload.doc.modifiedDateRange.startDateGMT == null ? "missing" : "invalid"
            }.`
          );
        }
        if (!nc.isNonEmptyString(stub.payload.doc.modifiedDateRange.endDateGMT)) {
          stub.messages.push(
            `The payload.doc.modifiedDateRange.endDateGMT string is ${
              stub.payload.doc.modifiedDateRange.endDateGMT == null ? "missing" : "invalid"
            }.`
          );
        }
      }
    }

    if (stub.messages.length > 0) {
      stub.messages.forEach(msg => logError(msg));
      stub.out.ncStatusCode = 400;
      throw new Error(`Invalid request [${stub.messages.join(" ")}]`);
    }
    logInfo("Function is valid.");
  }

  async function getProductLists() {
    logInfo("Get product lists...");
    return await Promise.all(stub.channelProfile.channelSettingsValues.subscriptionLists.map(getProductList));
  }

  async function getProductList(subscriptionList) {
    logInfo(`Get product list [${subscriptionList.listId}]...`);
    const response = await stub.request.get({
      url: `${stub.channelProfile.channelSettingsValues.protocol}://catalogs${
        stub.channelProfile.channelSettingsValues.environment
      }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Catalog/Items(SourceId=${
        subscriptionList.listId
      })`
    });
    response.body.Items.forEach(item => {
      item.subscriptionList = subscriptionList;
    });
    return response.body.Items;
  }

  async function flattenProductLists(productLists) {
    logInfo("Flatten product lists...");
    return [].concat(...productLists);
  }

  async function getProductDetails(productList) {
    logInfo("Get product details...");
    const allIds = productList.map(p => p.CatalogItemId);
    const batchedIds = [];
    const max = 500;
    let current = 0;
    do {
      const batchIds = allIds.slice(current, current + max);
      batchedIds.push(batchIds);
      current = current + max;
    } while (current < allIds.length);
    const batchedDetails = await Promise.all(batchedIds.map(getProductDetailsBulk));
    const CatalogItems = Object.assign({}, ...batchedDetails);
    productList.forEach(product => {
      product.ProductDetails = CatalogItems[product.CatalogItemId];
    });
    return productList;
  }

  async function getProductDetailsBulk(catalogIds) {
    logInfo(`Get ${catalogIds.length} product details...`);
    const response = await stub.request.post({
      url: `${stub.channelProfile.channelSettingsValues.protocol}://catalogs${
        stub.channelProfile.channelSettingsValues.environment
      }.iqmetrix.net/v1/Companies(${
        stub.channelProfile.channelAuthValues.company_id
      })/Catalog/Items/ProductDetails/Bulk`,
      body: {
        CatalogItemIds: catalogIds
      }
    });
    return response.body.CatalogItems;
  }

  async function filterVendors(productList) {
    logInfo("Filter vendors...");
    productList.forEach(product => {
      const supplierId = product.subscriptionList.supplierId;
      const VendorSkus = product.ProductDetails.VendorSkus.filter(vendor => {
        return vendor.Entity && vendor.Entity.Id === supplierId;
      });
      product.VendorSku = VendorSkus[0];
    });
    return productList;
  }

  async function getAvailability(productList) {
    logInfo("Get supplier availability for all skus...");
    const supplierSkuLists = await Promise.all(
      stub.channelProfile.channelSettingsValues.subscriptionLists.map(getSupplierSkus)
    );
    const flatSkuLists = [].concat(...supplierSkuLists);
    productList.forEach(product => {
      const vendorSku = product.ProductDetails.VendorSkus[0].Value;
      const entityId = product.ProductDetails.VendorSkus[0].Entity.Id;
      const quantities = flatSkuLists.filter(s => s.SupplierSku == vendorSku && s.SupplierEntityId == entityId);
      if (quantities.length === 1) {
        product.SupplierSku = quantities[0];
      } else if (quantities.length > 1) {
        throw new Error(`Vendor sku ${vendorSku} has multiple inventory records for supplier ${entityId}`);
      }
    });
    return productList;
  }

  async function getSupplierSkus(subscriptionList) {
    logInfo(`Get skus for supplier [${subscriptionList.supplierId}]...`);
    const response = await stub.request.get({
      url: `${stub.channelProfile.channelSettingsValues.protocol}://availability${
        stub.channelProfile.channelSettingsValues.environment
      }.iqmetrix.net/v1/Suppliers(${subscriptionList.supplierId})/Companies(${
        stub.channelProfile.channelAuthValues.company_id
      })/SupplierSkus`,

      qs: {
        $filter: `LastModifiedDateUtc ge datetime'${
          stub.payload.doc.modifiedDateRange.startDateGMT
        }' and LastModifiedDateUtc le datetime'${
            stub.payload.doc.modifiedDateRange.endDateGMT
        }'`
      }
    });
    return response.body;
  }

  async function keepModifiedItems(productList) {
    logInfo("Keep items whose quantity has been modified...");
    const products = productList.filter(product => {
        return nc.isNonEmptyObject(product.SupplierSku);
    });
    logInfo(`${products.length} of ${productList.length} quantities have been modified within the given date range.`);
    return products;
  }

  async function buildResponseObject(products) {
    if (products.length > 0) {
      logInfo(`Submitting ${products.length} modified product quantities...`);
      stub.out.ncStatusCode = 200;
      stub.out.payload = [];
      products.forEach(product => {
        stub.out.payload.push({
          doc: product,
          productQuantityRemoteID: product.CatalogItemId,
          productQuantityBusinessReference: nc.extractBusinessReferences(
            stub.channelProfile.productQuantityBusinessReferences,
            product
          )
        });
      });
    } else {
      logInfo("No product quantities have been modified.");
      stub.out.ncStatusCode = 204;
    }
  }

  async function handleError(error) {
    logError(error);
    if (error.name === "StatusCodeError") {
      stub.out.response.endpointStatusCode = error.statusCode;
      stub.out.response.endpointStatusMessage = error.message;
      if (error.statusCode >= 500) {
        stub.out.ncStatusCode = 500;
      } else if (error.statusCode === 429) {
        logWarn("Request was throttled.");
        stub.out.ncStatusCode = 429;
      } else {
        stub.out.ncStatusCode = 400;
      }
    }
    stub.out.payload.error = error;
    stub.out.ncStatusCode = stub.out.ncStatusCode || 500;
  }
}

module.exports.GetProductQuantityFromQuery = GetProductQuantityFromQuery;
