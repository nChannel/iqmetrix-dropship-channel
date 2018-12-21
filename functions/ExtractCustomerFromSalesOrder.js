"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: {},
    errors: []
  };

  try {
    this.info("Extracting customer from order...");
    if (this.isNonEmptyObject(payload.doc.Customer)) {
      output.payload = payload.doc.Customer;
      output.statusCode = 200;
    } else {
      this.warn("No customer found on the order.");
      output.statusCode = 204;
    }
    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.errors.push(err);
    throw output;
  }
};
