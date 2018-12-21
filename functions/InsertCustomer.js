"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: {},
    errors: []
  };

  try {
    this.info("Inserting new customer record...");

    const req = this.request({
      method: "POST",
      baseUrl: this.getBaseUrl("crm"),
      url: `/v1/Companies(${this.company_id})/Customers`,
      body: payload.doc
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`POST customer request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    output.payload = resp.body;
    output.payload.Addresses = payload.doc.Addresses || [];
    output.payload.ContactMethods = payload.doc.ContactMethods || [];
    output.statusCode = 201;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }
};
