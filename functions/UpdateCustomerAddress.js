"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: {},
    errors: []
  };

  try {
    this.info("Updating existing customer address record...");

    const customerId = payload.doc.CustomerId || payload.customerRemoteID;
    const addressId = payload.doc.Id || payload.customerAddressRemoteID;

    const req = this.request({
      method: "PUT",
      baseUrl: this.getBaseUrl("crm"),
      url: `/v1/Companies(${this.company_id})/Customers(${customerId})/Addresses(${addressId})`,
      body: payload.doc
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`PUT customer address request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    output.payload = resp.body;
    output.statusCode = 200;

    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }
};
