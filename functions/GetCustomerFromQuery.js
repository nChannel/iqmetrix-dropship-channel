"use strict";

module.exports = async function(flowContext, queryDoc) {
  const output = {
    statusCode: 400,
    errors: [],
    payload: []
  };

  try {
    const queryType = this.validateQueryDoc(queryDoc);
    let customers = [];
    let hasMore = false;

    switch (queryType) {
      case "remoteIDs": {
        const remoteIds = [...new Set(queryDoc.remoteIDs)].filter(x => x.trim());
        const totalResults = remoteIds.length;
        const startIndex = (queryDoc.page - 1) * queryDoc.pageSize;
        const endIndex = queryDoc.page * queryDoc.pageSize;
        const remoteIdsBatch = remoteIds.slice(startIndex, endIndex);

        customers = await Promise.all(remoteIdsBatch.map(id => getCustomerFull.bind(this)(id, null, queryDoc)));

        hasMore = queryDoc.page * queryDoc.pageSize <= totalResults;
        break;
      }

      case "createdDateRange": {
        this.warn("Searching by createdDateRange is not supported, will search on modifiedDateRange instead.");
        queryDoc.modifiedDateRange = queryDoc.createdDateRange;
        delete queryDoc.createdDateRange;
      }
      case "modifiedDateRange": {
        this.warn("EndDate will be ignored when searching on modified date range (will use StartDate to Now).");
        const startDate = new Date(Date.parse(queryDoc.modifiedDateRange.startDateGMT)).toISOString();
        customers = await getCustomerFull.bind(this)(null, startDate, queryDoc);
        hasMore = !(customers.length < queryDoc.pageSize);
        break;
      }

      default: {
        throw new Error(`Invalid request, unknown query type: '${queryType}'`);
      }
    }

    this.info(customers.length > 0 ? `Submitting ${customers.length} customer(s)...` : "No customers found.");
    output.statusCode = hasMore ? 206 : customers.length > 0 ? 200 : 204;
    output.payload = customers;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }

  async function getCustomerFull(customerId, startDate, queryDoc) {
    this.info("Getting Customer(s) from iQmetrix...");
    let url = `/v1/Companies(${this.company_id})/CustomerFull`;
    let qs = {};

    if (customerId != null) {
      url += `(${customerId})`;
    } else if (startDate != null) {
      qs = {
        $filter: `LastModifiedDateUtc ge datetime'${startDate}'`,
        $skip: (queryDoc.page - 1) * queryDoc.pageSize,
        $top: queryDoc.pageSize
      };
    } else {
      throw new TypeError("One of customerId or startDate must be provided.");
    }

    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("crm"),
      url: url,
      qs: qs
    });
    

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`CustomerFull request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (customerId != null) {
      if (!resp.body || !resp.body.Id) {
        throw new TypeError("CustomerFull response is not in expected format, expected Id property.");
      }
    }
    if (startDate != null) {
      if (!resp.body || !this.isArray(resp.body)) {
        throw new TypeError("CustomerFull response is not in expected format, expected an array.");
      }
    }

    return resp.body;
  }
};
