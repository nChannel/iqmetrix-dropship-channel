"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: {},
    errors: []
  };

  try {
    this.info("Extracting billing address from order...");
    if (this.isNonEmptyObject(payload.doc.BillingAddress)) {
      output.payload = payload.doc.BillingAddress;
      output.payload.CustomerId =
        output.payload.CustomerId || payload.billingCustomerRemoteID || payload.customerRemoteID;
      output.statusCode = 200;
    } else {
      this.warn("No billing address found on the order.");
      output.statusCode = 204;
    }
    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.errors.push(err);
    throw output;
  }
};
