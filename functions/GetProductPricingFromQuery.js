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

            if (!nc.isInteger(stub.channelProfile.channelSettingsValues.maxParallelRequests)) {
                stub.messages.push(
                    `The channelProfile.channelSettingsValues.maxParallelRequests integer is ${
                        stub.channelProfile.channelSettingsValues.maxParallelRequests == null ? "missing" : "invalid"
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

    async function getPrices(productList) {
        logInfo("Get prices...");
        const numProducts = productList.length;
        if (stub.channelProfile.channelSettingsValues.maxParallelRequests === 0) {
            stub.channelProfile.channelSettingsValues.maxParallelRequests = numProducts;
        }
        let products = [];
        let current = 0;
        do {
            const batch = productList.slice(
                current,
                current + stub.channelProfile.channelSettingsValues.maxParallelRequests
            );
            logInfo(
                `Get products ${current} - ${current +
                    stub.channelProfile.channelSettingsValues.maxParallelRequests}...`
            );
            current = current + stub.channelProfile.channelSettingsValues.maxParallelRequests;
            const productBatch = await Promise.all(batch.map(getPricing));
            products.push(...productBatch);
        } while (current < numProducts);
        return products;
    }

    async function getPricing(product) {
        logInfo(`Get pricing for product ${product.CatalogItemId}...`);
        const response = await stub.request.get({
            url: `${stub.channelProfile.channelSettingsValues.protocol}://pricing${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Entities(${
                stub.channelProfile.channelAuthValues.location_id
            })/CatalogItems(${product.CatalogItemId})/Pricing`
        });
        product.Pricing = response.body[0];
        return product;
    }

     // The necessary timestamp is not yet being returned by the iQmetrix API,
     // so it will never find any modified prices currently.
    async function keepModifiedItems(productList) {
        logInfo("Keep items whose quantity has been modified...");
        const start = Date.parse(stub.payload.doc.modifiedDateRange.startDateGMT);
        const end = Date.parse(stub.payload.doc.modifiedDateRange.endDateGMT);
        const products = productList.filter(product => {
            const priceMod = Date.parse(product.Pricing.DateUpdatedUtc);
            return priceMod >= start && priceMod <= end;
        });
        logInfo(`${products.length} of ${productList.length} prices have been modified within the given date range.`);
        return products;
    }

    async function buildResponseObject(products) {
        if (products.length > 0) {
            logInfo(`Submitting ${products.length} modified product prices...`);
            stub.out.ncStatusCode = 200;
            stub.out.payload = [];
            products.forEach(product => {
                stub.out.payload.push({
                    doc: product,
                    productPricingRemoteID: product.CatalogItemId,
                    productPricingBusinessReference: nc.extractBusinessReferences(
                        stub.channelProfileproductPricingBusinessReferences,
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
