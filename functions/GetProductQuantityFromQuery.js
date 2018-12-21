"use strict";

module.exports = async function(flowContext, queryDoc) {
  const output = {
    statusCode: 400,
    errors: [],
    payload: []
  };
  let totalResults;

  try {
    const queryType = this.validateQueryDoc(queryDoc);
    let supplierSkus = [];

    switch (queryType) {
      case "remoteIDs": {
        const remoteIdSearchResults = await remoteIdSearch.bind(this)(queryDoc);
        supplierSkus.push(...remoteIdSearchResults);
        break;
      }

      case "createdDateRange": {
        this.warn("Searching by createdDateRange is not supported, will search on modifiedDateRange instead.");
        queryDoc.modifiedDateRange = queryDoc.createdDateRange;
        delete queryDoc.createdDateRange;
      }
      case "modifiedDateRange": {
        const dateRangeSearchResults = await dateRangeSearch.bind(this)(queryDoc);
        supplierSkus.push(...dateRangeSearchResults);
        break;
      }

      default: {
        throw new Error(`Invalid request, unknown query type: '${queryType}'`);
      }
    }

    const hasMore = queryDoc.page * queryDoc.pageSize <= totalResults;
    supplierSkus = supplierSkus.filter(x => x);

    this.info(
      supplierSkus.length > 0 ? `Submitting ${supplierSkus.length} updated product quantities...` : "No products found."
    );
    output.statusCode = hasMore ? 206 : supplierSkus.length > 0 ? 200 : 204;
    output.payload = supplierSkus;

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
    const remoteIDs = queryDoc.remoteIDs.slice(startIndex, endIndex);

    let availabilities = [];

    availabilities = await Promise.all(
      this.subscriptionLists.map(async subscriptionList => {
        const availabilityList = await getSupplierAvailabilities.bind(this)(subscriptionList.supplierId, remoteIDs);
        const availabilityDetails = await getDetails.bind(this)(availabilityList, subscriptionList.listId);
        return availabilityDetails;
      }, this)
    );

    return availabilities;
  }

  async function dateRangeSearch(queryDoc) {
    let availableSkus = [];

    availableSkus = await Promise.all(
      this.subscriptionLists.map(async subscriptionList => {
        const availabilityList = await getAvailabilityList.bind(this)(
          subscriptionList.supplierId,
          queryDoc.modifiedDateRange.startDateGMT,
          queryDoc.modifiedDateRange.endDateGMT
        );
        const availabilityDetails = await getDetails.bind(this)(availabilityList, subscriptionList.listId);
        return availabilityDetails;
      }, this)
    );

    return [].concat(...availableSkus);
  }

  async function getDetails(supplierAvailabilities, subscriptionListId) {
    const availableSkus = [];
    let vendorSkuDetails = [];
    const total = supplierAvailabilities.length;
    this.info(`SupplierAvailabilities count: ${total}`);

    vendorSkuDetails = await Promise.all(
      supplierAvailabilities.map(async (a, i) => {
        let result = await getVendorSkuDetails.bind(this)(a, subscriptionListId, i + 1, total);
        return result;
      }, this)
    );

    supplierAvailabilities.forEach(item =>
      Object.assign(
        item,
        vendorSkuDetails.find(d => d.VendorId === item.SupplierEntityId && d.Sku === item.SupplierSku)
      )
    );
    let skippedSkus = [];
    availableSkus.push(...supplierAvailabilities.filter(l => this.isNonEmptyArray(l.Items)));
    skippedSkus.push(...supplierAvailabilities.filter(l => !this.isNonEmptyArray(l.Items)));
    this.info(`SupplierSku count: ${availableSkus.length}`);
    this.info(`SupplierSkus with an empty Items array: ${skippedSkus.length}`);
    return availableSkus.length > 0 ? availableSkus : null;
  }

  async function getAvailabilityList(supplierId, startDate, endDate) {
    this.info(`Getting availability for supplier ${supplierId}`);

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("availability"),
      url: `/v1/Suppliers(${supplierId})/Companies(${this.company_id})/SupplierSkus`,
      qs: {
        $filter: `LastModifiedDateUtc ge datetime'${startDate}' and LastModifiedDateUtc le datetime'${endDate}'`
      }
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`Availability by supplier request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!this.isArray(resp.body)) {
      throw new TypeError("Response is not in expected format, expected an array of availability objects.");
    }

    return resp.body;
  }

  async function getSupplierAvailabilities(supplierId, remoteIDs) {
    this.info(`Getting BulkSupplierAvailability for supplier ${supplierId}`);

    let supplierAvailabilities = remoteIDs.map(i => {
      const supplierSku = { SupplierSku: i };
      return supplierSku;
    });

    const req = this.request({
      method: "POST",
      baseUrl: this.getBaseUrl("availability"),
      url: `/v1/Suppliers(${supplierId})/Companies(${this.company_id})/BulkSupplierAvailability`,
      body: {
        SupplierAvailabilities: supplierAvailabilities
      }
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`BulkSupplierAvailability request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!resp.body || !this.isArray(resp.body.SupplierAvailabilities)) {
      throw new TypeError("Response is not in expected format, expected SupplierAvailabilities array.");
    }

    return resp.body.SupplierAvailabilities;
  }

  async function getVendorSkuDetails(availabilityItem, subscriptionListId, index, total) {
    let vendorSkuDetail = { Items: [] };
    if (this.isNonEmptyString(availabilityItem.SupplierSku)) {
      vendorSkuDetail = await getVendorSkuDetail.bind(this)(
        availabilityItem.SupplierSku,
        availabilityItem.SupplierEntityId,
        index,
        total
      );
    } else {
      this.info(`AvailabilityItem with Id ${availabilityItem.Id} has no SupplierSku. Skipping.`);
    }
    vendorSkuDetail.Items = vendorSkuDetail.Items.filter(i => i.SourceIds.includes(subscriptionListId));
    return vendorSkuDetail;
  }

  async function getVendorSkuDetail(vendorSku, vendorId, index, total) {
    this.info(`Getting catalog item details (${index}/${total}) by vendor '${vendorId}' and sku '${vendorSku}'`);

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
      this.info(
        `Details by VendorSku request (${index}/${total}) completed in ${Math.round(
          resp.timingPhases.total
        )} milliseconds.`
      );
    }

    if (!resp.body || !this.isArray(resp.body.Items)) {
      throw new TypeError("Details by VendorSku Response is not in expected format, expected Items[] property.");
    }

    if (!this.isNonEmptyArray(resp.body.Items)) {
      this.info(`Vendor '${vendorId}' and SKU '${vendorSku}' returned 0 Items.`);
    }

    return resp.body;
  }
};
