"use strict";

module.exports = async function(flowContext, queryDoc) {
  const output = {
    statusCode: 400,
    errors: [],
    payload: []
  };
  let totalResults;
  let singleVariantIsSimple = true;
  let subscriptionListVendorIds;

  try {
    const queryType = this.validateQueryDoc(queryDoc);
    subscriptionListVendorIds = this.subscriptionLists.map(l => l.supplierId);
    let products = [];
    let searchResults;

    switch (queryType) {
      case "remoteIDs": {
        searchResults = await remoteIdSearch.bind(this)(queryDoc);
        products.push(...searchResults);
        break;
      }

      case "modifiedDateRange": {
        this.warn("Searching by modifiedDateRange is not supported, will search on createdDateRange instead.");
        queryDoc.createdDateRange = queryDoc.modifiedDateRange;
        delete queryDoc.modifiedDateRange;
      }
      case "createdDateRange": {
        searchResults = await createdDateRangeSearch.bind(this)(queryDoc);

        products = await Promise.all(
          this.subscriptionLists.map(async subscriptionList => {
            const listItems = JSON.parse(JSON.stringify(searchResults));
            const filteredMatrixItems = await getFilteredMatrixItems.bind(this)(listItems, subscriptionList);
            return filteredMatrixItems;
          }, this)
        );
        products = [].concat(...products);

        await getProductDetails.bind(this)(products);
        break;
      }

      default: {
        throw new Error(`Invalid request, unknown query type: '${queryType}'`);
      }
    }

    const hasMore = queryDoc.page * queryDoc.pageSize <= totalResults;

    this.info(products.length > 0 ? `Submitting ${products.length} matrix products...` : "No products found.");
    output.statusCode = hasMore ? 206 : products.length > 0 ? 200 : 204;
    output.payload = products;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }

  async function remoteIdSearch(queryDoc) {
    // search for remote ids.
    queryDoc.remoteIDs = [...new Set(queryDoc.remoteIDs)].filter(x => x.trim());
    totalResults = queryDoc.remoteIDs.length;
    const startIndex = (queryDoc.page - 1) * queryDoc.pageSize;
    const endIndex = queryDoc.page * queryDoc.pageSize;
    let catalogItems = [];
    const remoteIdsBatch = queryDoc.remoteIDs.slice(startIndex, endIndex);

    catalogItems = await Promise.all(remoteIdsBatch.map(getStructureByCatalogId.bind(this)));

    // keep only unique parent objects
    let uniqueCatalogItems = [];
    catalogItems.forEach(i => {
      if (i.Slug != null && !uniqueCatalogItems.some(x => x.Slug === i.Slug)) {
        uniqueCatalogItems.push(i);
      }
    });
    catalogItems = uniqueCatalogItems;

    let subscribedMatrixItems = [];
    subscribedMatrixItems = await Promise.all(
      this.subscriptionLists.map(async subscriptionList => {
        let subscribedItems = JSON.parse(JSON.stringify(catalogItems));

        // keep only child variations that we are subscribed to.
        subscribedItems.forEach(i => {
          i.Variations = i.Variations.filter(v =>
            v.CatalogItems.some(c => c.SourceIds.includes(subscriptionList.listId))
          );
        });

        // keep only matrix items
        subscribedItems = subscribedItems.filter(i =>
          singleVariantIsSimple
            ? this.isNonEmptyArray(i.Variations) && i.Variations.length > 1
            : this.isNonEmptyArray(i.Variations)
        );

        // get unique slugs from all parents and children
        const slugSet = new Set();
        subscribedItems.forEach(i => {
          slugSet.add(i.Slug);
          i.Variations.forEach(v => {
            slugSet.add(v.Slug);
          });
        });

        // get slug details for all parents and children
        let slugDetails = await getSlugDetails.bind(this)([...slugSet]);

        // merge additional slug details to each parent and child
        subscribedItems.forEach(i => {
          i = Object.assign(i, slugDetails[i.Slug]);
          i.ncSubscriptionList = subscriptionList;
          i.ncVendorSku = i.VendorSkus.find(s => s.Entity.Id == subscriptionList.supplierId) || null;
          if (this.isNonEmptyArray(i.Variations)) {
            i.Variations.forEach(v => {
              v = Object.assign(v, slugDetails[v.Slug]);
              v.ncSubscriptionList = subscriptionList;
              v.ncVendorSku = v.VendorSkus.find(s => s.Entity.Id == subscriptionList.supplierId) || null;
            });
          }
        });

        return subscribedItems;
      }, this)
    );

    subscribedMatrixItems = [].concat(...subscribedMatrixItems);
    return subscribedMatrixItems;
  }

  async function createdDateRangeSearch(queryDoc) {
    this.info(
      `Searching for matrix products created between ${queryDoc.createdDateRange.startDateGMT} and ${
        queryDoc.createdDateRange.endDateGMT
      }`
    );

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("catalogs"),
      url: `/v1/Companies(${this.company_id})/Catalog/GroupedSearch`,
      qs: {
        VendorIds: subscriptionListVendorIds.join(),
        CreatedFromUtc: queryDoc.createdDateRange.startDateGMT,
        CreatedToUtc: queryDoc.createdDateRange.endDateGMT,
        HasChildProducts: true,
        Page: queryDoc.page,
        PageSize: queryDoc.pageSize,
        OrderBy: "dateAdded"
      }
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`GroupedSearch request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (
      !resp.body ||
      !this.isArray(resp.body.Items) ||
      !resp.body.MetaData ||
      !this.isNumber(resp.body.MetaData.TotalResults)
    ) {
      throw new TypeError("Response is not in expected format, expected Items[] and MetaData.TotalResults properties.");
    }

    totalResults = resp.body.MetaData.TotalResults;

    // Filter out variants that do not belong to any subscription list or are not supplied by one of our vendors.
    resp.body.Items.forEach(item => {
      if (this.isNonEmptyArray(item.Products)) {
        item.Products = item.Products.filter(product => {
          let isListSourced = typeof product.IsListSourced === "boolean" ? product.IsListSourced : true;
          let productVendorIds = this.isNonEmptyArray(product.Vendors) ? product.Vendors.map(v => v.Id) : [];

          return isListSourced && productVendorIds.some(id => subscriptionListVendorIds.includes(id));
        });
      }
    });

    // Filter out simple items.
    resp.body.Items = resp.body.Items.filter(item => {
      if (singleVariantIsSimple) {
        return this.isArray(item.Products) && item.Products.length > 1;
      }
      return this.isNonEmptyArray(item.Products);
    });

    return resp.body.Items;
  }

  async function getStructureByCatalogId(catalogItemId) {
    this.info(`Getting item structure by catalog id '${catalogItemId}'`);
    let resp;

    try {
      const req = this.request({
        method: "GET",
        baseUrl: this.getBaseUrl("catalogs"),
        url: `/v1/Companies(${this.company_id})/Catalog/Items(${catalogItemId})/Structure`
      });

      resp = await req;
      output.endpointStatusCode = resp.statusCode;
    } catch (error) {
      if (error.name === "StatusCodeError" && error.statusCode === 404) {
        this.warn(`Catalog Item for catalogItemId '${catalogItemId}' does not exist.`);
        resp = error.response;
      } else {
        throw error;
      }
    }

    if (resp.timingPhases) {
      this.info(`Item structure request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (resp.statusCode !== 404 && (!resp.body || !resp.body.Slug)) {
      throw new TypeError("Item structure response is not in expected format, expected Slug property.");
    }

    return resp.statusCode !== 404 ? resp.body : null;
  }

  async function getFilteredMatrixItems(items, subscriptionList) {
    let filteredMatrixItems = [];
    filteredMatrixItems = await Promise.all(
      items.map(async item => {
        item.ncSubscriptionList = subscriptionList;
        item.ncVendorSku = item.Identifiers.find(
          i => i.SkuType === "VendorSKU" && i.Entity && i.Entity.Id == subscriptionList.supplierId
        );

        item.Products = await getFilteredVariants.bind(this)(item.Products, subscriptionList);

        let isMatrixItem = false;
        if (singleVariantIsSimple) {
          if (this.isArray(item.Products) && item.Products.length > 1) {
            isMatrixItem = true;
          }
        } else if (this.isNonEmptyArray(item.Products)) {
          isMatrixItem = true;
        }

        if (isMatrixItem) {
          if (item.ncVendorSku && item.ncVendorSku.Sku) {
            let vendorSkuDetail = await getVendorSkuDetail.bind(this)(item, subscriptionList);
            if (vendorSkuDetail != null) {
              Object.assign(item, vendorSkuDetail);
            }
          }
          return item;
        }
      }, this)
    );
    return filteredMatrixItems.filter(i => i != null);
  }

  async function getFilteredVariants(products, subscriptionList) {
    let filteredVariants = [];
    filteredVariants = await Promise.all(
      products.map(async product => {
        product.ncSubscriptionList = subscriptionList;
        product.ncVendorSku = product.Identifiers.find(
          p => p.SkuType === "VendorSKU" && p.Entity && p.Entity.Id == subscriptionList.supplierId
        );

        if (product.ncVendorSku && product.ncVendorSku.Sku) {
          let vendorSkuDetail = await getVendorSkuDetail.bind(this)(product, subscriptionList);
          if (vendorSkuDetail != null) {
            Object.assign(product, vendorSkuDetail);
            return product;
          }
        }
      }, this)
    );
    return filteredVariants.filter(v => v != null);
  }

  async function getProductDetails(matrixItems) {
    let catalogItemIds = new Set();
    let slugs = new Set();
    matrixItems.forEach(i => {
      if (this.isNonEmptyString(i.CatalogItemId) && i.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
        catalogItemIds.add(i.CatalogItemId);
      } else if (this.isNonEmptyString(i.Slug)) {
        slugs.add(i.Slug);
      }
      i.Products.forEach(p => {
        if (this.isNonEmptyString(p.CatalogItemId) && p.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
          catalogItemIds.add(p.CatalogItemId);
        } else if (this.isNonEmptyString(p.Slug)) {
          slugs.add(p.Slug);
        }
      });
    });

    let catalogItemDetails = await getCatalogItemDetails.bind(this)([...catalogItemIds]);
    let slugDetails = await getSlugDetails.bind(this)([...slugs]);

    matrixItems.forEach(i => {
      if (this.isNonEmptyString(i.CatalogItemId) && i.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
        Object.assign(i, catalogItemDetails[i.CatalogItemId]);
      } else if (this.isNonEmptyString(i.Slug)) {
        Object.assign(i, slugDetails[i.Slug]);
      }
      i.Products.forEach(p => {
        if (this.isNonEmptyString(p.CatalogItemId) && p.CatalogItemId !== "00000000-0000-0000-0000-000000000000") {
          Object.assign(p, catalogItemDetails[p.CatalogItemId]);
        } else if (this.isNonEmptyString(p.Slug)) {
          Object.assign(p, slugDetails[p.Slug]);
        }
      });
    });
  }

  async function getVendorSkuDetail(product, subscriptionList) {
    let vendorSkuDetails = await getDetailsByVendorSku.bind(this)(product.ncVendorSku.Sku, subscriptionList.supplierId);
    return vendorSkuDetails.Items.find(i => {
      if (this.isNonEmptyArray(i.SourceIds) && i.SourceIds.includes(subscriptionList.listId)) {
        if (
          this.isNonEmptyString(product.CatalogItemId) &&
          product.CatalogItemId !== "00000000-0000-0000-0000-000000000000" &&
          product.CatalogItemId === i.CatalogItemId
        ) {
          return true;
        } else if (this.isNonEmptyString(product.Slug) && product.Slug === i.Slug) {
          return true;
        }
      }
    });
  }

  async function getDetailsByVendorSku(vendorSku, vendorId) {
    this.info(`Getting catalog item details by vendor '${vendorId}' and sku '${vendorSku}'`);

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("catalogs"),
      url: `/v1/Companies(${this.company_id})/Catalog/Items/ByVendorSku`,
      qs: {
        vendorId: vendorId,
        vendorSku: vendorSku
      }
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`Details by VendorSku request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!resp.body || !this.isArray(resp.body.Items)) {
      throw new TypeError("Response is not in expected format, expected Items[] property.");
    }

    return resp.body;
  }

  async function getCatalogItemDetails(catalogItemIds) {
    let catalogItems = {};

    if (this.isNonEmptyArray(catalogItemIds)) {
      this.info(`Getting bulk catalog item details by CatalogItemIds for ${catalogItemIds.length} total items.`);
      let chunks = [];
      while (catalogItemIds.length > 0) {
        chunks.push(catalogItemIds.splice(0, 500));
      }

      await Promise.all(
        chunks.map(async chunk => {
          if (chunk.length > 0) {
            this.info(`Requesting ${chunk.length} catalog item details.`);
            const req = this.request({
              method: "POST",
              baseUrl: this.getBaseUrl("catalogs"),
              url: `/v1/Companies(${this.company_id})/Catalog/Items/ProductDetails/Bulk`,
              body: {
                CatalogItemIds: chunk
              }
            });

            const resp = await req;
            output.endpointStatusCode = resp.statusCode;

            if (resp.timingPhases) {
              this.info(
                `Bulk catalog item details request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`
              );
            }

            if (!resp.body || !resp.body.CatalogItems) {
              throw new TypeError("Response is not in expected format, expected CatalogItems property.");
            }

            Object.assign(catalogItems, resp.body.CatalogItems);
          }
        }, this)
      );
    } else {
      this.info("No products to get catalog item details for.");
    }

    return catalogItems;
  }

  async function getSlugDetails(slugs) {
    let products = {};

    if (this.isNonEmptyArray(slugs)) {
      this.info(`Getting bulk product details by Slug for ${slugs.length} total items.`);
      let chunks = [];
      while (slugs.length > 0) {
        chunks.push(slugs.splice(0, 100));
      }

      await Promise.all(
        chunks.map(async chunk => {
          if (chunk.length > 0) {
            this.info(`Requesting ${chunk.length} slug details.`);
            const req = this.request({
              method: "GET",
              baseUrl: this.getBaseUrl("productlibrary"),
              url: "/v1/Products/GetBulk",
              qs: {
                Slugs: chunk.join()
              }
            });

            const resp = await req;
            output.endpointStatusCode = resp.statusCode;

            if (resp.timingPhases) {
              this.info(`Bulk slug details request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
            }

            if (!resp.body || !resp.body.Products) {
              throw new TypeError("Response is not in expected format, expected Products property.");
            }

            Object.assign(products, resp.body.Products);
          }
        }, this)
      );
    } else {
      this.info("No products to get slug details for.");
    }

    return products;
  }
};
