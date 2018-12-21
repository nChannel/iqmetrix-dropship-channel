"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: [],
    errors: []
  };

  try {
    this.info("Extracting customer addresses from customer...");
    if (this.isNonEmptyArray(payload.doc.Addresses)) {
      // Enrich customer address documents with customer remote id.
      payload.doc.Addresses = payload.doc.Addresses.map(address => {
        address.CustomerId = address.CustomerId || payload.doc.Id || payload.customerRemoteID;
        return address;
      });
      output.payload = payload.doc.Addresses;
      output.statusCode = 200;
    } else {
      this.warn("No customer addresses found on the customer.");
      output.statusCode = 204;
    }
    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.errors.push(err);
    throw output;
  }
};
