module.exports.GetProductSimpleFromQuery = (ncUtil, channelProfile, flowContext, payload, callback) => {
    const stubName = "GetProductSimpleFromQuery";
    const referenceLocations = ["productBusinessReferences"];
    const nc = require("./util/ncUtils");
    let companyId, subscriptionLists, subscriptionListVendorIds;
    let page, pageSize, totalResults;
    let singleVariantIsSimple = true;
    const stub = new nc.Stub(stubName, referenceLocations, ncUtil, channelProfile, flowContext, payload, callback);

    function logInfo(msg) {
        stub.log(msg, "info");
    }

    function logWarn(msg) {
        stub.log(msg, "warn");
    }

    function logError(msg) {
        stub.log(msg, "error");
    }

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

    async function initializeStubFunction() {
        if (!stub.isValid) {
            stub.messages.forEach(msg => logError(msg));
            stub.out.ncStatusCode = 400;
            throw new Error(`Invalid request [${stub.messages.join(" ")}]`);
        }

        logInfo("Stub function is valid.");

        if (typeof stub.channelProfile.channelSettingsValues.singleVariantIsSimple === "boolean") {
            singleVariantIsSimple = stub.channelProfile.channelSettingsValues.singleVariantIsSimple;
        }

        companyId = stub.channelProfile.channelAuthValues.company_id;
        subscriptionLists = stub.channelProfile.channelSettingsValues.subscriptionLists;
        subscriptionListVendorIds = subscriptionLists.map(l => l.supplierId);

        page = stub.payload.doc.page;
        pageSize = stub.payload.doc.pageSize;

        return JSON.parse(JSON.stringify(stub.payload.doc));
    }

    async function searchForProducts(queryDoc) {
        const simpleItems = [];
        let searchResults;

        switch (stub.queryType) {
            case "remoteIDs":
                searchResults = await remoteIdSearch(queryDoc);
                simpleItems.push(...searchResults);
                break;

            case "modifiedDateRange":
                logWarn("Searching by modifiedDateRange is not supported, will search on createdDateRange instead.");
                queryDoc.createdDateRange = queryDoc.modifiedDateRange;
            case "createdDateRange":
                searchResults = await createdDateRangeSearch(queryDoc);

                for (const subscriptionList of subscriptionLists) {
                    const listItems = JSON.parse(JSON.stringify(searchResults));
                    const filteredSimpleItems = await getSubscribedSimpleItems(listItems, subscriptionList);
                    simpleItems.push(...filteredSimpleItems);
                }

                await getProductDetails(simpleItems);
                break;

            default:
                stub.out.ncStatusCode = 400;
                throw new Error(`Invalid request, unknown query type: '${stub.queryType}'`);
        }

        return simpleItems;
    }

    async function remoteIdSearch(queryDoc) {
        // search for remote ids.
        queryDoc.remoteIDs = [...new Set(queryDoc.remoteIDs)].filter(x => x.trim());
        totalResults = queryDoc.remoteIDs.length;
        const startIndex = (page - 1) * pageSize;
        const endIndex = page * pageSize;
        let catalogItems = [];
        for (const remoteId of queryDoc.remoteIDs.slice(startIndex, endIndex)) {
            catalogItems.push(await getStructureByCatalogId(remoteId))
        }

        // keep only unique parent objects
        let uniqueCatalogItems = [];
        catalogItems.forEach(i => {
            if (i.Slug != null && !uniqueCatalogItems.some(x => x.Slug === i.Slug)) {
                uniqueCatalogItems.push(i);
            }
        })
        catalogItems = uniqueCatalogItems;

        const subscribedSimpleItems = [];
        for (const subscriptionList of subscriptionLists) {
            let subscribedItems = JSON.parse(JSON.stringify(catalogItems));

            // keep only child variations that we are subscribed to.
            subscribedItems.forEach(i => {
                i.Variations = i.Variations.filter(v =>
                    v.CatalogItems.some(c => c.SourceIds.includes(subscriptionList.listId))
                );
            });

            // merge single variations onto parent and keep only simple items.
            subscribedItems = subscribedItems.map(i => {
                if (!nc.isNonEmptyArray(i.Variations)) {
                    return i;
                } else {
                    if (i.Variations.length === 1 && singleVariantIsSimple) {
                        const simpleVariation = Object.assign(i, i.Variations[0])
                        simpleVariation.Variations = [];
                        return simpleVariation;
                    }
                }
            }).filter(x => x != null);

            // get slug details for all simple items
            let slugDetails = await getSlugDetails([...new Set(subscribedItems.map(s => s.Slug))]);

            // merge additional slug details to each simple item
            subscribedItems.forEach(i => {
              Object.assign(i, slugDetails[i.Slug]);
              i.ncSubscriptionList = subscriptionList;
              i.ncVendorSku = i.VendorSkus.find(v => v.Entity.Id == subscriptionList.supplierId);
            });

            subscribedSimpleItems.push(...subscribedItems);
        }

        return subscribedSimpleItems;
    }

    async function createdDateRangeSearch(queryDoc) {
        logInfo(`Searching for simple products created between ${queryDoc.createdDateRange.startDateGMT} and ${queryDoc.createdDateRange.endDateGMT}`);

        const req = stub.requestPromise.get(
            Object.assign({}, stub.requestDefaults, {
                method: "GET",
                baseUrl: stub.getBaseUrl("catalogs"),
                url: `/v1/Companies(${companyId})/Catalog/GroupedSearch`,
                qs: {
                    VendorIds: subscriptionListVendorIds.join(),
                    CreatedFromUtc: queryDoc.createdDateRange.startDateGMT,
                    CreatedToUtc: queryDoc.createdDateRange.endDateGMT,
                    Page: queryDoc.page,
                    PageSize: queryDoc.pageSize,
                    OrderBy: "dateAdded"
                }
            })
        );
        logInfo(`Calling: ${req.method} ${req.uri.href}`);

        const resp = await req;
        stub.out.response.endpointStatusCode = resp.statusCode;
        stub.out.response.endpointStatusMessage = resp.statusMessage;

        if (resp.timingPhases) {
            logInfo(`GroupedSearch request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
        }

        if (
            !resp.body ||
            !nc.isArray(resp.body.Items) ||
            !resp.body.MetaData ||
            !nc.isNumber(resp.body.MetaData.TotalResults)
        ) {
            throw new TypeError("Response is not in expected format, expected Items[] and MetaData.TotalResults properties.");
        }

        totalResults = resp.body.MetaData.TotalResults;

        // Filter out products that do not belong to any subscription list or are not supplied by one of our vendors.
        resp.body.Items = resp.body.Items.filter(item => {
            if (!nc.isNonEmptyArray(item.Products)) {
                const isListSourced = typeof item.IsListSourced === "boolean" ? item.IsListSourced : true;
                const itemVendorIds = nc.isNonEmptyArray(item.Vendors) ? item.Vendors.map(v => v.Id) : [];
                return isListSourced && itemVendorIds.some(id => subscriptionListVendorIds.includes(id));
            } else {
                item.Products = item.Products.filter(product => {
                    let isListSourced = typeof product.IsListSourced === "boolean" ? product.IsListSourced : true;
                    let productVendorIds = nc.isNonEmptyArray(product.Vendors) ? product.Vendors.map(v => v.Id) : [];
                    return isListSourced && productVendorIds.some(id => subscriptionListVendorIds.includes(id));
                });
                return nc.isNonEmptyArray(item.Products);
            }
        });

        return resp.body.Items;
    }

    async function getStructureByCatalogId(catalogItemId) {
        logInfo(`Getting item structure by catalog id '${catalogItemId}'`);
        let resp;

        try {
            const req = stub.requestPromise.get(Object.assign({}, stub.requestDefaults, {
                method: "GET",
                baseUrl: stub.getBaseUrl("catalogs"),
                url: `/v1/Companies(${companyId})/Catalog/Items(${catalogItemId})/Structure`
            }));
            logInfo(`Calling: ${req.method} ${req.uri.href}`);

            resp = await req;
        } catch (error) {
            if (error.name === "StatusCodeError" && error.statusCode === 404) {
                logWarn(`Catalog Item for catalogItemId '${catalogItemId}' does not exist.`);
                resp = error.response;
            } else {
                throw error;
            }
        }

        stub.out.response.endpointStatusCode = resp.statusCode;
        stub.out.response.endpointStatusMessage = resp.statusMessage;

        if (resp.timingPhases) {
            logInfo(`Item structure request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
        }

        if ((resp.statusCode !== 404) && (!resp.body || !resp.body.Slug)) {
            throw new TypeError("Item structure esponse is not in expected format, expected Slug property.");
        }

        return resp.statusCode !== 404 ? resp.body : null;
    }

    async function getSubscribedSimpleItems(items, subscriptionList) {
        let subscribedItems = [];
        for (const item of items) {
            item.ncSubscriptionList = subscriptionList;
            item.ncVendorSku = item.Identifiers.find(i => i.SkuType === "VendorSKU" && i.Entity && i.Entity.Id == subscriptionList.supplierId);
            if (item.ncVendorSku && item.ncVendorSku.Sku) {
                let vendorSkuDetail = await getVendorSkuDetail(item, subscriptionList);
                if (vendorSkuDetail != null) {
                    Object.assign(item, vendorSkuDetail);
                }
            }
            item.Products = await getFilteredVariants(item.Products, subscriptionList);

            if (nc.isNonEmptyArray(item.Products)) {
                subscribedItems.push(item);
            } else {
                if (nc.isNonEmptyArray(item.SourceIds)) {
                    subscribedItems.push(item);
                }
            }
        }
        subscribedItems = subscribedItems.filter(i => i != null);

        return subscribedItems.map(item => {
            if (nc.isNonEmptyArray(item.Products)) {
                if (singleVariantIsSimple && item.Products.length === 1) {
                    Object.assign(item, item.Products[0]);
                    item.Products = [];
                    return item;
                }
            } else {
                return item;
            }
        }).filter(i => i != null);
    }

    async function getFilteredVariants(products, subscriptionList) {
        let filteredVariants = [];
        for (const product of products) {
            product.ncSubscriptionList = subscriptionList;
            product.ncVendorSku = product.Identifiers.find(p => p.SkuType === "VendorSKU" && p.Entity && p.Entity.Id == subscriptionList.supplierId);

            if (product.ncVendorSku && product.ncVendorSku.Sku) {
                let vendorSkuDetail = await getVendorSkuDetail(product, subscriptionList);
                if (vendorSkuDetail != null) {
                    Object.assign(product, vendorSkuDetail);
                    filteredVariants.push(product);
                }
            }
        }
        return filteredVariants.filter(v => v != null);
    }

    async function getProductDetails(simpleItems) {
        let catalogItemIds = new Set();
        let slugs = new Set();
        simpleItems.forEach(i => {
            if (nc.isNonEmptyString(i.CatalogItemId) && i.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
                catalogItemIds.add(i.CatalogItemId);
            } else if (nc.isNonEmptyString(i.Slug)) {
                slugs.add(i.Slug);
            }
            i.Products.forEach(p => {
                if (nc.isNonEmptyString(p.CatalogItemId) && p.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
                    catalogItemIds.add(p.CatalogItemId);
                } else if (nc.isNonEmptyString(p.Slug)) {
                    slugs.add(p.Slug);
                }
            });
        });

        let catalogItemDetails = await getCatalogItemDetails([...catalogItemIds]);
        let slugDetails = await getSlugDetails([...slugs]);

        simpleItems.forEach(i => {
            if (nc.isNonEmptyString(i.CatalogItemId) && i.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
                Object.assign(i, catalogItemDetails[i.CatalogItemId]);
            } else if (nc.isNonEmptyString(i.Slug)) {
                Object.assign(i, slugDetails[i.Slug]);
            }
            i.Products.forEach(p => {
                if (nc.isNonEmptyString(p.CatalogItemId) && p.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
                    Object.assign(p, catalogItemDetails[p.CatalogItemId]);
                } else if (nc.isNonEmptyString(p.Slug)) {
                    Object.assign(p, slugDetails[p.Slug]);
                }
            });
        });
    }

    async function getVendorSkuDetail(product, subscriptionList) {
        let vendorSkuDetails = await getDetailsByVendorSku(product.ncVendorSku.Sku, subscriptionList.supplierId);
        return vendorSkuDetails.Items.find(i => {
            if (nc.isNonEmptyArray(i.SourceIds) && i.SourceIds.includes(subscriptionList.listId)) {
                if (
                    nc.isNonEmptyString(product.CatalogItemId) &&
                    product.CatalogItemId !== "00000000-0000-0000-0000-000000000000" &&
                    product.CatalogItemId === i.CatalogItemId
                ) {
                    return true;
                } else if (nc.isNonEmptyString(product.Slug) && product.Slug === i.Slug) {
                    return true;
                }
            }
        });
    }

    async function getDetailsByVendorSku(vendorSku, vendorId) {
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
            throw new TypeError("Response is not in expected format, expected Items[] property.");
        }

        return resp.body;
    }

    async function getCatalogItemDetails(catalogItemIds) {
        let catalogItems = {};

        if (nc.isNonEmptyArray(catalogItemIds)) {
            logInfo(`Getting bulk catalog item details by CatalogItemIds for ${catalogItemIds.length} total items.`);
            let chunks = [];
            while (catalogItemIds.length > 0) {
                chunks.push(catalogItemIds.splice(0, 500));
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

    async function getSlugDetails(slugs) {
        let products = {};

        if (nc.isNonEmptyArray(slugs)) {
            logInfo(`Getting bulk product details by Slug for ${slugs.length} total items.`);
            let chunks = [];
            while (slugs.length > 0) {
                chunks.push(slugs.splice(0, 100));
            }

            for (const chunk of chunks) {
                if (chunk.length > 0) {
                    logInfo(`Requesting ${chunk.length} slug details.`);
                    const req = stub.requestPromise.get(
                        Object.assign({}, stub.requestDefaults, {
                            method: "GET",
                            baseUrl: stub.getBaseUrl("productlibrary"),
                            url: "/v1/Products/GetBulk",
                            qs: {
                                Slugs: chunk.join()
                            }
                        })
                    );
                    logInfo(`Calling: ${req.method} ${req.uri.href}`);

                    const resp = await req;
                    stub.out.response.endpointStatusCode = resp.statusCode;
                    stub.out.response.endpointStatusMessage = resp.statusMessage;

                    if (resp.timingPhases) {
                        logInfo(
                            `Bulk slug details request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`
                        );
                    }

                    if (!resp.body || !resp.body.Products) {
                        throw new TypeError("Response is not in expected format, expected Products property.");
                    }

                    Object.assign(products, resp.body.Products);
                }
            }
        } else {
            logInfo("No products to get slug details for.");
        }

        return products;
    }

    async function buildResponseObject(simpleItems) {
        if (simpleItems.length > 0) {
            logInfo(`Submitting ${simpleItems.length} simple products...`);

            stub.out.payload = [];
            simpleItems.forEach(item => {
                stub.out.payload.push({
                    doc: item,
                    productRemoteID: item.CatalogItemId,
                    productBusinessReference: nc.extractBusinessReferences(stub.channelProfile.productBusinessReferences, item)
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
