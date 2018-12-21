"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: {},
    errors: []
  };

  try {
    this.info("Inserting new customer contact record...");

    const customerId = payload.doc.CustomerId || payload.customerRemoteID;

    const req = this.request({
      method: "POST",
      baseUrl: this.getBaseUrl("crm"),
      url: `/v1/Companies(${this.company_id})/Customers(${customerId})/ContactMethods`,
      body: payload.doc
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`POST customer contact request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    output.payload = resp.body;
    output.statusCode = 201;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }
};
