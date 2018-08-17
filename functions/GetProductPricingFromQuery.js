module.exports.GetProductPricingFromQuery = (ncUtil, channelProfile, flowContext, payload, callback) => {
  const stubName = "GetProductPricingFromQuery";
  const referenceLocations = ["productPricingBusinessReferences"];
  const nc = require("./util/ncUtils");
  let companyId, locationId, subscriptionLists;
  let page, pageSize;
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
    locationId = stub.channelProfile.channelAuthValues.location_id;
    subscriptionLists = stub.channelProfile.channelSettingsValues.subscriptionLists;

    page = stub.payload.doc.page;
    pageSize = stub.payload.doc.pageSize;

    return JSON.parse(JSON.stringify(stub.payload.doc));
  }

  async function searchForProducts(queryDoc) {
    const changedPrices = [];

    switch (stub.queryType) {
      case "remoteIDs": {
        const remoteIdSearchResults = await remoteIdSearch(queryDoc);
        changedPrices.push(...remoteIdSearchResults);
        break;
      }

      case "createdDateRange": {
        logWarn("Searching by createdDateRange is not supported, will search on modifiedDateRange instead.");
        queryDoc.createdDateRange = queryDoc.createdDateRange;
      }
      case "modifiedDateRange": {
        const prices = await getChangedPrices(queryDoc);
        const catalogItemIds = prices.map(p => p.CatalogItemId);
        let catalogItems = await getCatalogItems([...new Set(catalogItemIds)]);

        for (const subscriptionList of subscriptionLists) {
          await Promise.all(
            catalogItemIds.map(async catalogItemId => {
              const catalogItem = catalogItems[catalogItemId];
              if (catalogItem) {
                const vendorSku = catalogItem.VendorSkus.find(
                  s => s.Entity && s.Entity.Id === subscriptionList.supplierId && s.Value
                );
                if (vendorSku) {
                  const ncVendorSku = await getVendorSkuDetail(vendorSku.Value, subscriptionList.supplierId);
                  if (ncVendorSku && nc.isNonEmptyArray(ncVendorSku.Items)) {
                    ncVendorSku.Items = ncVendorSku.Items.filter(i => i.SourceIds.includes(subscriptionList.listId));
                  }
                  if (nc.isNonEmptyArray(ncVendorSku.Items)) {
                    catalogItem.ncVendorSkus = catalogItem.ncVendorSkus || [];
                    catalogItem.ncVendorSkus.push(ncVendorSku);
                  }
                }
              }
            })
          );
        }

        const filteredCatalogItems = {};
        for (const i in catalogItems) {
          if (nc.isNonEmptyArray(catalogItems[i].ncVendorSkus)) {
            filteredCatalogItems[i] = catalogItems[i];
          }
        }
        prices.forEach(p => {
          p.ncCatalogItem = filteredCatalogItems[p.CatalogItemId];
        });
        changedPrices.push(...prices.filter(p => p.ncCatalogItem != null));
        break;
      }

      default:
        stub.out.ncStatusCode = 400;
        throw new Error(`Invalid request, unknown query type: '${stub.queryType}'`);
    }

    return changedPrices;
  }

  async function remoteIdSearch(queryDoc) {
    stub.out.ncStatusCode = 400;
    throw new Error("Searching by remote id has not been implemented.");
  }

  async function getChangedPrices(queryDoc) {
    logInfo(`Getting prices that have changed since ${queryDoc.modifiedDateRange.startDateGMT}`);

    const req = stub.requestPromise.get(
      Object.assign({}, stub.requestDefaults, {
        method: "GET",
        baseUrl: stub.getBaseUrl("pricing"),
        url: `/v1/Companies(${companyId})/Entities(${locationId})/ChangedPrices`,
        qs: {
          $skip: (page - 1) * pageSize,
          $top: pageSize,
          $filter: `LastModifiedDateUtc ge datetime'${
            queryDoc.modifiedDateRange.startDateGMT
          }' and LastModifiedDateUtc le datetime'${queryDoc.modifiedDateRange.endDateGMT}'`
        }
      })
    );
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`Changed Prices request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!nc.isArray(resp.body)) {
      throw new TypeError("Changed Prices Response is not in expected format, expected an array.");
    }

    logInfo(`x-ratelimit-remaining: ${resp.headers['x-ratelimit-remaining']}`);

    if (parseInt(resp.headers['x-ratelimit-remaining']) < 10) {
      logInfo('Sleeping for 61 seconds to allow the iqmetrix quota to refresh');
      await sleep();
    }

    return resp.body;
  }

  async function getCatalogItems(catalogIds) {
    let catalogItems = {};

    if (nc.isNonEmptyArray(catalogIds)) {
      logInfo(`Getting bulk catalog item details by CatalogItemIds for ${catalogIds.length} total items.`);
      let chunks = [];
      while (catalogIds.length > 0) {
        chunks.push(catalogIds.splice(0, 500));
      }

      for (const chunk of chunks) {
        if (chunk.length > 0) {
          logInfo(`Requesting ${chunk.length} catalog item details.`);
          const req = stub.requestPromise.post(
            Object.assign({}, stub.requestDefaults, {
              method: "POST",
              baseUrl: stub.getBaseUrl("catalogs"),
              url: `/v1/Companies(${companyId})/Catalog/Items/ProductDetails/Bulk`,
              body: {
                CatalogItemIds: chunk
              }
            })
          );
          logInfo(`Calling: ${req.method} ${req.uri.href}`);

          const resp = await req;
          stub.out.response.endpointStatusCode = resp.statusCode;
          stub.out.response.endpointStatusMessage = resp.statusMessage;

          if (resp.timingPhases) {
            logInfo(
              `Bulk catalog item details request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`
            );
          }

          if (!resp.body || !resp.body.CatalogItems) {
            throw new TypeError("Response is not in expected format, expected CatalogItems property.");
          }

          Object.assign(catalogItems, resp.body.CatalogItems);
        }
      }
    } else {
      logInfo("No products to get catalog item details for.");
    }

    return catalogItems;
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

    logInfo(`x-ratelimit-remaining: ${resp.headers['x-ratelimit-remaining']}`);

    if (parseInt(resp.headers['x-ratelimit-remaining']) < 10) {
      logInfo('Sleeping for 61 seconds to allow the iqmetrix quota to refresh');
      await sleep();
    }

    return resp.body;
  }

  async function buildResponseObject(changedPrices) {
    if (changedPrices.length > 0) {
      logInfo(`Submitting ${changedPrices.length} updated prices...`);

      stub.out.payload = [];
      changedPrices.forEach(item => {
        stub.out.payload.push({
          doc: item,
          productPricingRemoteID: item.Id,
          productPricingBusinessReference: nc.extractBusinessReferences(
            stub.channelProfile.productPricingBusinessReferences,
            item
          )
        });
      });

      stub.out.ncStatusCode = changedPrices.length != pageSize ? 200 : 206;
    } else {
      logInfo(`No${page > 1 ? " additional " : " "}products found.`);
      stub.out.ncStatusCode = 204;
    }
    console.log("output");
    console.log(JSON.stringify(changedPrices));
    return stub.out;
  }

  async function handleError(error) {
    logError(error.stack);
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

  function sleep() {
    return new Promise(resolve => setTimeout(resolve, 61000));
  }
};
