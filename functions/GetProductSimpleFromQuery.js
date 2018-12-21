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
            const filteredSimpleItems = await getSubscribedSimpleItems.bind(this)(listItems, subscriptionList);
            return filteredSimpleItems;
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

    this.info(products.length > 0 ? `Submitting ${products.length} simple products...` : "No products found.");
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

    let subscribedSimpleItems = [];

    subscribedSimpleItems = await Promise.all(
      this.subscriptionLists.map(async subscriptionList => {
        let subscribedItems = JSON.parse(JSON.stringify(catalogItems));

        // keep only child variations that we are subscribed to.
        subscribedItems.forEach(i => {
          i.Variations = i.Variations.filter(v =>
            v.CatalogItems.some(c => c.SourceIds.includes(subscriptionList.listId))
          );
        });

        // merge single variations onto parent and keep only simple items.
        subscribedItems = subscribedItems
          .map(i => {
            if (!this.isNonEmptyArray(i.Variations)) {
              return i;
            } else {
              if (i.Variations.length === 1 && singleVariantIsSimple) {
                const simpleVariation = Object.assign(i, i.Variations[0]);
                simpleVariation.Variations = [];
                return simpleVariation;
              }
            }
          })
          .filter(x => x != null);

        // get slug details for all simple items
        let slugDetails = await getSlugDetails.bind(this)([...new Set(subscribedItems.map(s => s.Slug))]);

        // merge additional slug details to each simple item
        subscribedItems.forEach(i => {
          Object.assign(i, slugDetails[i.Slug]);
          i.ncSubscriptionList = subscriptionList;
          i.ncVendorSku = i.VendorSkus.find(v => v.Entity.Id == subscriptionList.supplierId);
        });

        return subscribedItems;
      }, this)
    );
    subscribedSimpleItems = [].concat(...subscribedSimpleItems);

    return subscribedSimpleItems;
  }

  async function createdDateRangeSearch(queryDoc) {
    this.info(
      `Searching for simple products created between ${queryDoc.createdDateRange.startDateGMT} and ${
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

    // Filter out products that do not belong to any subscription list or are not supplied by one of our vendors.
    resp.body.Items = resp.body.Items.filter(item => {
      if (!this.isNonEmptyArray(item.Products)) {
        const isListSourced = typeof item.IsListSourced === "boolean" ? item.IsListSourced : true;
        const itemVendorIds = this.isNonEmptyArray(item.Vendors) ? item.Vendors.map(v => v.Id) : [];
        return isListSourced && itemVendorIds.some(id => subscriptionListVendorIds.includes(id));
      } else {
        item.Products = item.Products.filter(product => {
          let isListSourced = typeof product.IsListSourced === "boolean" ? product.IsListSourced : true;
          let productVendorIds = this.isNonEmptyArray(product.Vendors) ? product.Vendors.map(v => v.Id) : [];
          return isListSourced && productVendorIds.some(id => subscriptionListVendorIds.includes(id));
        });
        return this.isNonEmptyArray(item.Products);
      }
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

  async function getSubscribedSimpleItems(items, subscriptionList) {
    let subscribedItems = [];
    subscribedItems = await Promise.all(
      items.map(async item => {
        item.ncSubscriptionList = subscriptionList;
        item.ncVendorSku = item.Identifiers.find(
          i => i.SkuType === "VendorSKU" && i.Entity && i.Entity.Id == subscriptionList.supplierId
        );
        if (item.ncVendorSku && item.ncVendorSku.Sku) {
          let vendorSkuDetail = await getVendorSkuDetail.bind(this)(item, subscriptionList);
          if (vendorSkuDetail != null) {
            Object.assign(item, vendorSkuDetail);
          }
        }
        item.Products = await getFilteredVariants.bind(this)(item.Products, subscriptionList);

        if (this.isNonEmptyArray(item.Products)) {
          return item;
        } else {
          if (this.isNonEmptyArray(item.SourceIds)) {
            return item;
          }
        }
      }, this)
    );
    subscribedItems = subscribedItems.filter(i => i != null);

    return subscribedItems
      .map(item => {
        if (this.isNonEmptyArray(item.Products)) {
          if (singleVariantIsSimple && item.Products.length === 1) {
            Object.assign(item, item.Products[0]);
            item.Products = [];
            return item;
          }
        } else {
          return item;
        }
      })
      .filter(i => i != null);
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

  async function getProductDetails(simpleItems) {
    let catalogItemIds = new Set();
    let slugs = new Set();
    simpleItems.forEach(i => {
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

    simpleItems.forEach(i => {
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
