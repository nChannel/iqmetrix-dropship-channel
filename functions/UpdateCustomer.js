"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: {},
    errors: []
  };

  try {
    this.info("Updating existing customer record...");

    const customerId = payload.doc.Id || payload.customerRemoteID;

    const req = this.request({
      method: "PUT",
      baseUrl: this.getBaseUrl("crm"),
      url: `/v1/Companies(${this.company_id})/Customers(${customerId})`,
      body: payload.doc
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`PUT customer request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    output.payload = resp.body;
    output.payload.Addresses = payload.doc.Addresses || [];
    output.payload.ContactMethods = payload.doc.ContactMethods || [];
    output.statusCode = 200;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }
};
