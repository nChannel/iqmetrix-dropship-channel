"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: [],
    errors: []
  };

  try {
    this.info("Extracting customer contact methods from customer...");
    if (this.isNonEmptyArray(payload.doc.ContactMethods)) {
      // Enrich customer contact documents with customer remote id.
      payload.doc.ContactMethods = payload.doc.ContactMethods.map(contact => {
        contact.CustomerId = contact.CustomerId || payload.doc.Id || payload.customerRemoteID;
        return contact;
      });
      output.payload = payload.doc.ContactMethods;
      output.statusCode = 200;
    } else {
      this.warn("No customer contact methods found on the customer.");
      output.statusCode = 204;
    }
    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.errors.push(err);
    throw output;
  }
};
