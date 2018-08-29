function GetProductPricingFromQuery(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["productPricingBusinessReferences"];
    const stub = new nc.Stub("GetProductPricingFromQuery", referenceLocations, ...arguments);

    validateFunction()
        .then(getProductLists)
        .then(flattenProductLists)
        .then(getProductDetails)
        .then(filterVendors)
        .then(getPrices)
        .then(buildResponseObject)
        .catch(handleError)
        .then(() => {
          console.log(stub.out);
          callback(stub.out)})
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

            if (!nc.isNonEmptyString(stub.channelProfile.channelAuthValues.location_id)) {
                stub.messages.push(
                    `The channelProfile.channelAuthValues.location_id string is ${
                        stub.channelProfile.channelAuthValues.location_id == null ? "missing" : "invalid"
                    }.`
                );
            }

            if (stub.payload.doc.remoteIDs != null && !nc.isNonEmptyArray(stub.payload.doc.remoteIDs)) {
                stub.messages.push("payload.doc.remoteIDs was provided, but is either empty or not an array.");
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
        console.time("Elapsed Time");
        const productLists = [];
        for (const list of stub.channelProfile.channelSettingsValues.subscriptionLists) {
            const productList = await getProductList(list);
            productLists.push(productList);
        }
        return productLists;
    }

    async function getProductList(subscriptionList) {
        logInfo(`Get product list [${subscriptionList.listId}]...`);
        const response = await stub.requestPromise.get(Object.assign({}, stub.requestDefaults, {
            url: `${stub.channelProfile.channelSettingsValues.protocol}://catalogs${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Catalog/Items(SourceId=${
                subscriptionList.listId
            })`
        }));
        response.body.Items.forEach(item => {
            item.subscriptionList = subscriptionList;
        });
        return response.body.Items;
    }

    async function flattenProductLists(productLists) {
        logInfo("Flatten product lists...");
        let flattenedProductLists = [].concat(...productLists);

        if (nc.isNonEmptyArray(stub.payload.doc.remoteIDs)) {
            flattenedProductLists = flattenedProductLists.filter(l =>
              stub.payload.doc.remoteIDs.includes(l.CatalogItemId)
            );
        }

        return flattenedProductLists;
    }

    async function getProductDetails(productList) {
        logInfo("Get product details...");
        logInfo(`Total product count: ${productList.length}`);
        const allIds = productList.map(p => p.CatalogItemId);
        const batchedIds = [];
        const max = 500;
        let current = 0;
        do {
            const batchIds = allIds.slice(current, current + max);
            batchedIds.push(batchIds);
            current = current + max;
        } while (current < allIds.length);
        let batchedDetails = [];
        for (const b of batchedIds) {
            if (b.length > 0) {
                let result = await getProductDetailsBulk(b);
                batchedDetails.push(result);
            }
        }
        const CatalogItems = Object.assign({}, ...batchedDetails);
        productList.forEach(product => {
            product.ProductDetails = CatalogItems[product.CatalogItemId];
        });
        return productList;
    }

    async function getProductDetailsBulk(catalogIds) {
        logInfo(`Get ${catalogIds.length} product details...`);
        const response = await stub.requestPromise.post(Object.assign({}, stub.requestDefaults, {
            url: `${stub.channelProfile.channelSettingsValues.protocol}://catalogs${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${
                stub.channelProfile.channelAuthValues.company_id
            })/Catalog/Items/ProductDetails/Bulk`,
            body: {
                CatalogItemIds: catalogIds
            }
        }));
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

    async function getPrices(productList) {
        logInfo("Get prices...");

        let products = [];
        for (const p of productList) {
            const result = await getPricing(p);
            products.push(result);
        }

        return products;
    }

    async function getPricing(product) {
        logInfo(`Get pricing for product ${product.CatalogItemId}...`);
        const response = await stub.requestPromise.get(Object.assign({}, stub.requestDefaults, {
            url: `${stub.channelProfile.channelSettingsValues.protocol}://pricing${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Entities(${
                stub.channelProfile.channelAuthValues.location_id
            })/CatalogItems(${product.CatalogItemId})/Pricing`
        }));
        product.Pricing = response.body[0];
        return product;
    }

    async function buildResponseObject(products) {
        console.timeEnd("Elapsed Time");
        logInfo(`Total processed product count: ${products.length}`);
        if (products.length > 0) {
            logInfo(`Submitting ${products.length} modified product prices...`);
            stub.out.ncStatusCode = 200;
            stub.out.payload = [];
            products.forEach(product => {
                stub.out.payload.push({
                    doc: product,
                    productPricingRemoteID: product.CatalogItemId,
                    productPricingBusinessReference: nc.extractBusinessReferences(
                        stub.channelProfile.productPricingBusinessReferences,
                        product
                    )
                });
            });
        } else {
            logInfo("No product prices have been modified.");
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

module.exports.GetProductPricingFromQuery = GetProductPricingFromQuery;
