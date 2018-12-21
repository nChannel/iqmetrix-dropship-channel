"use strict";

module.exports = async function(flowContext, queryDoc) {
  const output = {
    statusCode: 400,
    errors: [],
    payload: []
  };

  try {
    const queryType = this.validateQueryDoc(queryDoc);
    const filters = [`companyId eq ${this.company_id}`, "statusName eq Completed", `locationId eq ${this.location_id}`];
    let fulfillments = [];
    let totalResults = 0;

    switch (queryType) {
      case "remoteIDs": {
        const remoteIds = [...new Set(remoteIds)].filter(x => x.trim());
        totalResults = remoteIds.length;
        const startIndex = (queryDoc.page - 1) * queryDoc.pageSize;
        const endIndex = queryDoc.page * queryDoc.pageSize;
        const remoteIdsBatch = remoteIds.slice(startIndex, endIndex);

        fulfillments = await Promise.all(remoteIdsBatch.map(getOrderInfo.bind(this)));

        break;
      }

      case "createdDateRange": {
        filters.push(`createdUtc gt ${new Date(Date.parse(queryDoc.createdDateRange.startDateGMT) - 1).toISOString()}`);
        filters.push(`createdUtc lt ${new Date(Date.parse(queryDoc.createdDateRange.endDateGMT) + 1).toISOString()}`);
        const orderReport = await getOrderReport.bind(this)(filters, queryDoc);
        totalResults = orderReport.totalRecords;

     
        fulfillments = await Promise.all(orderReport.rows.map(row => getOrderInfo.bind(this)(row._id)));

        break;
      }
      case "modifiedDateRange": {
        filters.push(
          `updatedUtc gt ${new Date(Date.parse(queryDoc.modifiedDateRange.startDateGMT) - 1).toISOString()}`
        );
        filters.push(`updatedUtc lt ${new Date(Date.parse(queryDoc.modifiedDateRange.endDateGMT) + 1).toISOString()}`);
        const orderReport = await getOrderReport.bind(this)(filters, queryDoc);
        totalResults = orderReport.totalRecords;

        fulfillments = await Promise.all(orderReport.rows.map(row => getOrderInfo.bind(this)(row._id)));

        break;
      }

      default: {
        throw new Error(`Invalid request, unknown query type: '${queryType}'`);
      }
    }

    const hasMore = queryDoc.page * queryDoc.pageSize <= totalResults;

    this.info(fulfillments.length > 0 ? `Submitting ${fulfillments.length} fulfillments...` : "No fulfillments found.");
    output.statusCode = hasMore ? 206 : fulfillments.length > 0 ? 200 : 204;
    output.payload = fulfillments;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }

  async function getOrderReport(filters, queryDoc) {
    const filter = filters.join(" and ");
    this.info(`Getting order report with filter: '${filter}'`);

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("ordermanagementreporting"),
      url: "/v1/Reports/OrderList/report",
      qs: {
        filter: filter,
        page: queryDoc.page,
        pageSize: queryDoc.pageSize,
        sortBy: "createdUtc",
        sortOrder: "asc"
      }
    });
    

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`Order report request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!resp.body || !this.isArray(resp.body.rows) || !this.isNumber(resp.body.totalRecords)) {
      throw new TypeError(
        "Order report response is not in expected format, expected rows[] and totalRecords properties."
      );
    }

    this.info(`Order report response contains ${resp.body.rows.length} of ${resp.body.totalRecords} records.`);

    return resp.body;
  }

  async function getOrderInfo(id) {
    const order = await getOrderDetail.bind(this)(id);
    if (order != null) {
      order.orderFull = await getOrderFull.bind(this)(order.invoiceNumber);
    }
    return order;
  }

  async function getOrderDetail(orderId) {
    this.info(`Getting order detail for order '${orderId}'`);

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("ordermanagementreporting"),
      url: `/v1/Companies(${this.company_id})/OrderDetails(${orderId})`
    });
    

    let resp;
    try {
      resp = await req;
      output.endpointStatusCode = resp.statusCode;
    } catch (error) {
      this.warn(`Failed to get order detail for order '${orderId}': ${error.message}`);
      resp = error.response;
    }

    if (resp != null) {
      if (resp.timingPhases) {
        this.info(`Order detail request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
      }

      if (!resp.body || !resp.body.id || !resp.body.invoiceNumber) {
        this.warn("Order detail response is not in expected format, expected id and invoiceNumber properties.");
        return null;
      }

      return resp.body;
    }

    return null;
  }

  async function getOrderFull(orderId) {
    this.info(`Getting order full details for order '${orderId}'`);

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("order"),
      url: `/v1/Companies(${this.company_id})/OrderFull`,
      qs: {
        $filter: `PrintableId eq '${orderId}'`
      }
    });
    

    let resp;
    try {
      resp = await req;
      output.endpointStatusCode = resp.statusCode;
    } catch (error) {
      this.warn(`Failed to get order full details for order '${orderId}': ${error.message}`);
      resp = error.response;
    }

    if (resp != null) {
      if (resp.timingPhases) {
        this.info(`Order full details request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
      }

      if (!this.isArray(resp.body) || resp.body.length > 1) {
        this.warn("Order full details response is not in expected format, expected an array with 1 or 0 objects.");
        return null;
      }

      if (resp.body.length === 0) {
        this.warn("Order full details response did not contain any results.");
        return null;
      }

      if (resp.body.length > 1) {
        this.warn("Order full details response contains multiple results.");
        return null;
      }

      return resp.body[0];
    }

    return null;
  }
};
