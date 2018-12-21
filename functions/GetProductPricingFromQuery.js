"use strict";

module.exports = async function(flowContext, queryDoc) {
  const output = {
    statusCode: 400,
    errors: [],
    payload: []
  };

  try {
    const queryType = this.validateQueryDoc(queryDoc);
    let products = [];

    this.info("Get product lists...");
    let productLists = await Promise.all(this.subscriptionLists.map(getProductList.bind(this)));
    products = [].concat(...productLists);

    switch (queryType) {
      case "remoteIDs": {
        products = products.filter(l => queryDoc.remoteIDs.includes(l.CatalogItemId));
        break;
      }

      case "createdDateRange": {
        this.warn("createdDateRange query is not supported, will get prices for all products on subscription lists.");
        break;
      }

      case "modifiedDateRange": {
        this.warn("modifiedDateRange query is not supported, will get prices for all products on subscription lists.");
        break;
      }

      default: {
        throw new Error(`Invalid request, unknown query type: '${queryType}'`);
      }
    }

    this.info(`Getting details for ${products.length} products.`);
    products = await getProductDetails.bind(this)(products);
    products = await filterVendors.bind(this)(products);
    products = await getPrices.bind(this)(products);

    this.info(products.length > 0 ? `Submitting ${products.length} product prices...` : "No product prices found.");
    output.statusCode = products.length > 0 ? 200 : 204;
    output.payload = products;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }

  async function getProductList(subscriptionList) {
    this.info(`Get product list [${subscriptionList.listId}]...`);

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("catalogs"),
      url: `/v1/Companies(${this.company_id})/Catalog/Items(SourceId=${subscriptionList.listId})`
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`Product list request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    resp.body.Items.forEach(item => {
      item.subscriptionList = subscriptionList;
    });

    return resp.body.Items;
  }

  async function getProductDetails(productList) {
    this.info("Get product details...");
    this.info(`Total product count: ${productList.length}`);
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

    batchedDetails = await Promise.all(batchedIds.filter(b => b.length > 0).map(getProductDetailsBulk.bind(this)));

    const CatalogItems = Object.assign({}, ...batchedDetails);
    productList.forEach(product => {
      product.ProductDetails = CatalogItems[product.CatalogItemId];
    });
    return productList;
  }

  async function getProductDetailsBulk(catalogIds) {
    this.info(`Get ${catalogIds.length} product details...`);

    const req = this.request({
      method: "POST",
      baseUrl: this.getBaseUrl("catalogs"),
      url: `/v1/Companies(${this.company_id})/Catalog/Items/ProductDetails/Bulk`,
      body: {
        CatalogItemIds: catalogIds
      }
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`Product details request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    return resp.body.CatalogItems;
  }

  async function filterVendors(productList) {
    this.info("Filter vendors...");
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
    const total = productList.length;
    this.info(`Getting prices for ${total} products...`);

    let products = await Promise.all(productList.map(getPricing.bind(this)));

    return products;
  }

  async function getPricing(product, index, productList) {
    this.info(`Getting price for product ${index + 1} of ${productList.length} (${product.CatalogItemId})...`);

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("pricing"),
      url: `/v1/Companies(${this.company_id})/Entities(${this.location_id})/CatalogItems(${
        product.CatalogItemId
      })/Pricing`
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(
        `Product pricing request ${index + 1} of ${productList.length} completed in ${Math.round(
          resp.timingPhases.total
        )} milliseconds.`
      );
    }

    product.Pricing = resp.body[0];
    return product;
  }
};
