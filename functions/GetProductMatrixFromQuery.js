function GetProductMatrixFromQuery(ncUtil, channelProfile, flowContext, payload, callback) {
  const nc = require("./util/ncUtils");
  const referenceLocations = ["productBusinessReferences"];
  const stub = new nc.Stub("GetProductMatrixFromQuery", referenceLocations, ...arguments);

  validateFunction()
    .then(getProductLists)
    .then(keepMatrixItems)
    .then(flattenProductLists)
    .then(addParents)
    .then(getProductDetails)
    .then(keepModifiedItems)
    .then(filterVendors)
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

  async function keepMatrixItems(productLists) {
    logInfo("Keep matrix items...");
    let totalCount = 0;
    let matrixCount = 0;
    const filteredProductLists = productLists.map(productList => {
      totalCount = totalCount + productList.length;
      const filtered = [];
      for (let i = 0; i < productList.length; i++) {
        const product = productList[i];
        if (productList.filter(p => p.Slug.split("-")[0] === product.Slug.split("-")[0]).length > 1) {
          filtered.push(product);
        }
      }
      matrixCount = matrixCount + filtered.length;
      return filtered;
    });
    logInfo(`${matrixCount} of ${totalCount} products are matrix variants.`);
    return filteredProductLists;
  }

  async function flattenProductLists(productLists) {
    logInfo("Flatten product lists...");
    return [].concat(...productLists);
  }

  async function addParents(productList) {
    let slugSet = new Set();
    productList.forEach(product => {
      slugSet.add(product.Slug.split("-")[0]);
    });
    slugSet.forEach(slug => {
      if (!productList.find(p => p.Slug === slug)) {
        productList.push({
          Slug: slug,
          subscriptionList: productList.find(p => p.Slug.split("-")[0] === slug).subscriptionList,
          ProductDetails: {}
        });
      }
    });

    return productList;
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

    for (let index = 0; index < productList.length; index++) {
      const product = productList[index];
      product.ProductDetails = CatalogItems[product.CatalogItemId];

      if (!product.ProductDetails) {
        const response = await stub.request.get({
          url: `${stub.channelProfile.channelSettingsValues.protocol}://productlibrary${
            stub.channelProfile.channelSettingsValues.environment
          }.iqmetrix.net/v1/products/${product.Slug}`
        });
        product.ProductDetails = response.body;
      }
    }

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

  async function keepModifiedItems(productList) {
    logInfo("Keep modified items...");
    const start = Date.parse(stub.payload.doc.modifiedDateRange.startDateGMT);
    const end = Date.parse(stub.payload.doc.modifiedDateRange.endDateGMT);
    const modifiedProducts = productList.filter(product => {
      const headerMod = Date.parse(product.DateUpdatedUtc);
      const detailMod = Date.parse(product.ProductDetails.DateUpdatedUtc);
      return (headerMod >= start && headerMod <= end) || (detailMod >= start && detailMod <= end);
    });
    logInfo(
      `${modifiedProducts.length} of ${productList.length} variants have been modified within the given date range.`
    );

    let parentSlugs = new Set();
    modifiedProducts.forEach(p => {
      parentSlugs.add(p.Slug.split("-")[0]);
    });

    const products = productList.filter(product => {
      return parentSlugs.has(product.Slug.split("-")[0]);
    });

    return products;
  }

  async function filterVendors(productList) {
    logInfo("Filter vendors...");
    productList.forEach(product => {
      const supplierId = product.subscriptionList.supplierId;
      const VendorSkus = product.ProductDetails.VendorSkus.filter(vendor => {
            return vendor.Entity && vendor.Entity.Id == supplierId;
          });
      product.VendorSku = VendorSkus[0];
    });
    return productList;
  }

  async function buildResponseObject(products) {
    if (products.length > 0) {
      const matrixProducts = [];
      let parentSlugs = new Set();
      products.forEach(p => {
        parentSlugs.add(p.Slug.split("-")[0]);
      });
      parentSlugs.forEach(parentSlug => {
        matrixProducts.push(products.find(p => p.Slug === parentSlug));
      });

      matrixProducts.forEach(matrixProduct => {
        matrixProduct.matrixChildren = products.filter(
          p => p.Slug.split("-")[0] === matrixProduct.Slug && p.Slug.split("-")[1] != null
        );
      });

      logInfo(`Submitting ${matrixProducts.length} modified matrix products...`);
      stub.out.ncStatusCode = 200;
      stub.out.payload = [];
      matrixProducts.forEach(product => {
        stub.out.payload.push({
          doc: product,
          productRemoteID: product.CatalogItemId,
          productBusinessReference: nc.extractBusinessReferences(stub.channelProfile.productBusinessReferences, product)
        });
      });
    } else {
      logInfo("No modified products found.");
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

module.exports.GetProductMatrixFromQuery = GetProductMatrixFromQuery;
