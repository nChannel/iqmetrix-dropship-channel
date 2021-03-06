module.exports.GetProductQuantityFromQuery = (ncUtil, channelProfile, flowContext, payload, callback) => {
  const stubName = "GetProductQuantityFromQuery";
  const referenceLocations = ["productQuantityBusinessReferences"];
  const nc = require("./util/ncUtils");
  let companyId, subscriptionLists;
  let page, pageSize, totalResults;
  const stub = new nc.Stub(stubName, referenceLocations, ncUtil, channelProfile, flowContext, payload, callback);

  initializeStubFunction()
    .then(searchForProducts)
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

  async function initializeStubFunction() {
    if (!stub.isValid) {
      stub.messages.forEach(msg => logError(msg));
      stub.out.ncStatusCode = 400;
      throw new Error(`Invalid request [${stub.messages.join(" ")}]`);
    }

    logInfo("Stub function is valid.");

    companyId = stub.channelProfile.channelAuthValues.company_id;
    subscriptionLists = stub.channelProfile.channelSettingsValues.subscriptionLists;

    page = stub.payload.doc.page;
    pageSize = stub.payload.doc.pageSize;

    return JSON.parse(JSON.stringify(stub.payload.doc));
  }

  async function searchForProducts(queryDoc) {
    const supplierSkus = [];

    switch (stub.queryType) {
      case "remoteIDs": {
        const remoteIdSearchResults = await remoteIdSearch(queryDoc);
        supplierSkus.push(...remoteIdSearchResults);
        break;
      }

      case "createdDateRange": {
        logWarn("Searching by createdDateRange is not supported, will search on modifiedDateRange instead.");
        queryDoc.modifiedDateRange = queryDoc.createdDateRange;
      }
      case "modifiedDateRange": {
        const dateRangeSearchResults = await dateRangeSearch(queryDoc);
        supplierSkus.push(...dateRangeSearchResults);
        break;
      }

      default:
        stub.out.ncStatusCode = 400;
        throw new Error(`Invalid request, unknown query type: '${stub.queryType}'`);
    }

    return supplierSkus;
  }

  async function remoteIdSearch(queryDoc) {
    // search for remote ids.
    queryDoc.remoteIDs = [...new Set(queryDoc.remoteIDs)].filter(x => x.trim());
    totalResults = queryDoc.remoteIDs.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = page * pageSize;
    const remoteIDs = queryDoc.remoteIDs.slice(startIndex, endIndex);

    const availabilities = [];
    for (const subscriptionList of subscriptionLists) {
      const availabilityList = await getSupplierAvailabilities(subscriptionList.supplierId, remoteIDs);
      const availabilityDetails = await getDetails(availabilityList, subscriptionList);
      availabilities.push(...availabilityDetails);
    }

    return availabilities;
  }

  async function dateRangeSearch(queryDoc) {
    const availableSkus = [];
    for (const subscriptionList of subscriptionLists) {
      const availabilityList = await getAvailabilityList(subscriptionList.supplierId, queryDoc.modifiedDateRange.startDateGMT, queryDoc.modifiedDateRange.endDateGMT);
      const availabilityDetails = await getDetails(availabilityList, subscriptionList);
      availableSkus.push(...availabilityDetails);
    }

    return availableSkus;
  }

  async function getDetails(supplierAvailabilities, subscriptionList) {
    const availableSkus = [];
    let vendorSkuDetails = [];
    let i = 0;
    const total = supplierAvailabilities.length;
    logInfo(`SupplierAvailabilities count: ${total}`);
    for (const a of supplierAvailabilities) {
      logInfo(`Getting details for item ${++i} of ${total}...`);
      let result = await getVendorSkuDetails(a, subscriptionList.listId);
      vendorSkuDetails.push(result);
    }
    supplierAvailabilities.forEach(item =>
      Object.assign(
        item,
        vendorSkuDetails.find(d => d.VendorId === item.SupplierEntityId && d.Sku === item.SupplierSku)
      )
    );
    let skippedSkus = [];
    availableSkus.push(...supplierAvailabilities.filter(l => nc.isNonEmptyArray(l.Items)));
    skippedSkus.push(...supplierAvailabilities.filter(l => !nc.isNonEmptyArray(l.Items)));
    logInfo(`SupplierSku count: ${availableSkus.length}`);
    logInfo(`SupplierSkus with an empty Items array: ${skippedSkus.length}`);
    return availableSkus;
  }

  async function getAvailabilityList(supplierId, startDate, endDate) {
    logInfo(`Getting availability for supplier ${supplierId}`);

    const req = stub.requestPromise.get(
      Object.assign({}, stub.requestDefaults, {
        method: "GET",
        baseUrl: stub.getBaseUrl("availability"),
        url: `/v1/Suppliers(${supplierId})/Companies(${companyId})/SupplierSkus`,
        qs: {
          $filter: `LastModifiedDateUtc ge datetime'${startDate}' and LastModifiedDateUtc le datetime'${endDate}'`
        }
      })
    );
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`Availability by supplier request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!nc.isArray(resp.body)) {
      throw new TypeError("Response is not in expected format, expected an array of availability objects.");
    }

    return resp.body;
  }

  async function getSupplierAvailabilities(supplierId, remoteIDs) {
    logInfo(`Getting BulkSupplierAvailability for supplier ${supplierId}`);

    let supplierAvailabilities = remoteIDs.map(i => {
      const supplierSku = { SupplierSku: i };
      return supplierSku;
    });

    const req = stub.requestPromise.post(Object.assign({}, stub.requestDefaults, {
        method: "POST",
        baseUrl: stub.getBaseUrl("availability"),
        url: `/v1/Suppliers(${supplierId})/Companies(${companyId})/BulkSupplierAvailability`,
        body: {
          SupplierAvailabilities: supplierAvailabilities
        }
      }));
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`BulkSupplierAvailability request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!resp.body || !nc.isArray(resp.body.SupplierAvailabilities)) {
      throw new TypeError("Response is not in expected format, expected SupplierAvailabilities array.");
    }

    return resp.body.SupplierAvailabilities;
  }

  async function getVendorSkuDetails(availabilityItem, subscriptionListId) {
    let vendorSkuDetail = { Items: [] };
    if (nc.isNonEmptyString(availabilityItem.SupplierSku)) {
      vendorSkuDetail = await getVendorSkuDetail(availabilityItem.SupplierSku, availabilityItem.SupplierEntityId);
    } else {
      logInfo(`AvailabilityItem with Id ${availabilityItem.Id} has no SupplierSku. Skipping.`);
    }
    vendorSkuDetail.Items = vendorSkuDetail.Items.filter(i => i.SourceIds.includes(subscriptionListId));
    return vendorSkuDetail;
  }

  async function getVendorSkuDetail(vendorSku, vendorId) {
    logInfo(`Getting catalog item details by vendor '${vendorId}' and sku '${vendorSku}'`);

    const req = stub.requestPromise.get(
      Object.assign({}, stub.requestDefaults, {
        method: "GET",
        baseUrl: stub.getBaseUrl("catalogs"),
        url: `/v1/Companies(${companyId})/Catalog/Items/ByVendorSku`,
        qs: {
          vendorId: vendorId,
          vendorSku: vendorSku
        }
      })
    );
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`Details by VendorSku request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!resp.body || !nc.isArray(resp.body.Items)) {
      throw new TypeError("Details by VendorSku Response is not in expected format, expected Items[] property.");
    }

    if (!nc.isNonEmptyArray(resp.body.Items)) {
      logInfo(`Vendor '${vendorId}' and SKU '${vendorSku}' returned 0 Items.`);
    }

    return resp.body;
  }

  async function buildResponseObject(supplierSkus) {
    if (supplierSkus.length > 0) {
      logInfo(`Submitting ${supplierSkus.length} updated quantities...`);

      stub.out.payload = [];
      supplierSkus.forEach(item => {
        stub.out.payload.push({
          doc: item,
          productQuantityRemoteID: item.Id,
          productQuantityBusinessReference: nc.extractBusinessReferences(
            stub.channelProfile.productQuantityBusinessReferences,
            item
          )
        });
      });

      stub.out.ncStatusCode = page * pageSize <= totalResults ? 206 : 200;
    } else {
      logInfo("No products found.");
      stub.out.ncStatusCode = page * pageSize <= totalResults ? 206 : 204;
    }

    return stub.out;
  }

  async function handleError(error) {
    logError(error);
    if (error.name === "StatusCodeError") {
      stub.out.response.endpointStatusCode = error.statusCode;
      stub.out.response.endpointStatusMessage = error.message;

      if (error.statusCode >= 500) {
        stub.out.ncStatusCode = 500;
      } else if ([429, 401].includes(error.statusCode)) {
        stub.out.ncStatusCode = error.statusCode;
      } else {
        stub.out.ncStatusCode = 400;
      }
    }
    stub.out.payload.error = error;
    stub.out.ncStatusCode = stub.out.ncStatusCode || 500;

    return stub.out;
  }

};
