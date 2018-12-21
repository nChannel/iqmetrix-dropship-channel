"use strict";

const Channel = require("@nchannel/endpoint-sdk").PromiseChannel;
const moment = require("moment");

class iqmetrix_dropship_channel extends Channel {
  constructor(...args) {
    super(...args);

    this.validateChannelProfile();

    this.protocol = this.channelProfile.channelSettingsValues.protocol;
    this.environment = this.channelProfile.channelSettingsValues.environment.trim();
    this.subscriptionLists = this.channelProfile.channelSettingsValues.subscriptionLists;
    this.canPostInvoice = this.channelProfile.channelSettingsValues.canPostInvoice;
    this.company_id = this.channelProfile.channelAuthValues.company_id;
    this.location_id = this.channelProfile.channelAuthValues.location_id;
    this.access_token = this.channelProfile.channelAuthValues.access_token;
    this.request = this.request.defaults({
      auth: {
        bearer: this.access_token
      },
      json: true,
      gzip: true,
      time: true,
      simple: true,
      resolveWithFullResponse: true
    });
  }

  async getCustomerById(...args) {
    return require("./functions/GetCustomerFromQuery").bind(this)(...args);
  }

  async getCustomerByCreatedTimeRange(...args) {
    return require("./functions/GetCustomerFromQuery").bind(this)(...args);
  }

  async getCustomerByModifiedTimeRange(...args) {
    return require("./functions/GetCustomerFromQuery").bind(this)(...args);
  }

  async insertCustomer(...args) {
    return require("./functions/InsertCustomer").bind(this)(...args);
  }

  async updateCustomer(...args) {
    return require("./functions/UpdateCustomer").bind(this)(...args);
  }

  async insertCustomerAddress(...args) {
    return require("./functions/InsertCustomerAddress").bind(this)(...args);
  }

  async updateCustomerAddress(...args) {
    return require("./functions/UpdateCustomerAddress").bind(this)(...args);
  }

  async insertCustomerContact(...args) {
    return require("./functions/InsertCustomerContact").bind(this)(...args);
  }

  async updateCustomerContact(...args) {
    return require("./functions/UpdateCustomerContact").bind(this)(...args);
  }

  async getProductSimpleById(...args) {
    return require("./functions/GetProductSimpleFromQuery").bind(this)(...args);
  }

  async getProductSimpleByCreatedTimeRange(...args) {
    return require("./functions/GetProductSimpleFromQuery").bind(this)(...args);
  }

  async getProductSimpleByModifiedTimeRange(...args) {
    return require("./functions/GetProductSimpleFromQuery").bind(this)(...args);
  }

  async getProductMatrixById(...args) {
    return require("./functions/GetProductMatrixFromQuery").bind(this)(...args);
  }

  async getProductMatrixByCreatedTimeRange(...args) {
    return require("./functions/GetProductMatrixFromQuery").bind(this)(...args);
  }

  async getProductMatrixByModifiedTimeRange(...args) {
    return require("./functions/GetProductMatrixFromQuery").bind(this)(...args);
  }

  async getProductQuantityById(...args) {
    return require("./functions/GetProductQuantityFromQuery").bind(this)(...args);
  }

  async getProductQuantityByCreatedTimeRange(...args) {
    return require("./functions/GetProductQuantityFromQuery").bind(this)(...args);
  }

  async getProductQuantityByModifiedTimeRange(...args) {
    return require("./functions/GetProductQuantityFromQuery").bind(this)(...args);
  }

  async getProductPricingById(...args) {
    return require("./functions/GetProductPricingFromQuery").bind(this)(...args);
  }

  async getProductPricingByCreatedTimeRange(...args) {
    return require("./functions/GetProductPricingFromQuery").bind(this)(...args);
  }

  async getProductPricingByModifiedTimeRange(...args) {
    return require("./functions/GetProductPricingFromQuery").bind(this)(...args);
  }

  async insertSalesOrder(...args) {
    return require("./functions/InsertSalesOrder").bind(this)(...args);
  }

  async getFulfillmentById(...args) {
    return require("./functions/GetFulfillmentFromQuery").bind(this)(...args);
  }

  async getFulfillmentByCreatedTimeRange(...args) {
    return require("./functions/GetFulfillmentFromQuery").bind(this)(...args);
  }

  async getFulfillmentByModifiedTimeRange(...args) {
    return require("./functions/GetFulfillmentFromQuery").bind(this)(...args);
  }

  async getPaymentCaptureById(...args) {
    return require("./functions/GetPaymentCaptureFromQuery").bind(this)(...args);
  }

  async getPaymentCaptureByCreatedTimeRange(...args) {
    return require("./functions/GetPaymentCaptureFromQuery").bind(this)(...args);
  }

  async getPaymentCaptureByModifiedTimeRange(...args) {
    return require("./functions/GetPaymentCaptureFromQuery").bind(this)(...args);
  }

  async extractBillingAddressFromSalesOrder(...args) {
    return require("./functions/ExtractBillingAddressFromSalesOrder").bind(this)(...args);
  }

  async extractShippingAddressFromSalesOrder(...args) {
    return require("./functions/ExtractShippingAddressFromSalesOrder").bind(this)(...args);
  }

  async extractCustomerFromSalesOrder(...args) {
    return require("./functions/ExtractCustomerFromSalesOrder").bind(this)(...args);
  }

  async extractCustomerAddressesFromCustomer(...args) {
    return require("./functions/ExtractCustomerAddressesFromCustomer").bind(this)(...args);
  }

  async extractCustomerContactsFromCustomer(...args) {
    return require("./functions/ExtractCustomerContactsFromCustomer").bind(this)(...args);
  }

  validateChannelProfile() {
    const errors = [];

    if (!this.isNonEmptyObject(this.channelProfile)) {
      errors.push(`The channelProfile object is ${this.channelProfile == null ? "missing" : "invalid"}.`);
    } else {
      if (!this.isNonEmptyObject(this.channelProfile.channelSettingsValues)) {
        errors.push(
          `The channelProfile.channelSettingsValues object is ${
            this.channelProfile.channelSettingsValues == null ? "missing" : "invalid"
          }.`
        );
      } else {
        if (!this.isNonEmptyString(this.channelProfile.channelSettingsValues.protocol)) {
          errors.push(
            `The channelProfile.channelSettingsValues.protocol string is ${
              this.channelProfile.channelSettingsValues.protocol == null ? "missing" : "invalid"
            }.`
          );
        }
        if (!this.isString(this.channelProfile.channelSettingsValues.environment)) {
          errors.push(
            `The channelProfile.channelSettingsValues.environment string is ${
              this.channelProfile.channelSettingsValues.environment == null ? "missing" : "invalid"
            }.`
          );
        }
        if (!this.isNonEmptyArray(this.channelProfile.channelSettingsValues.subscriptionLists)) {
          errors.push(
            `The channelProfile.channelSettingsValues.subscriptionLists array is ${
              this.channelProfile.channelSettingsValues.subscriptionLists == null ? "missing" : "invalid"
            }.`
          );
        } else {
          if (
            !this.channelProfile.channelSettingsValues.subscriptionLists.every(
              list =>
                this.isNonEmptyObject(list) && this.isNonEmptyString(list.listId) && this.isInteger(list.supplierId)
            )
          ) {
            errors.push("Every object in the subscriptionLists array must have both a listId and a supplierId.");
          }
        }
        if (!this.isNonEmptyString(this.channelProfile.channelSettingsValues.canPostInvoice)) {
          errors.push(
            `The channelProfile.channelSettingsValues.canPostInvoice string is ${
              this.channelProfile.channelSettingsValues.canPostInvoice == null ? "missing" : "invalid"
            }.`
          );
        }
      }

      if (!this.isNonEmptyObject(this.channelProfile.channelAuthValues)) {
        errors.push(
          `The channelProfile.channelAuthValues object is ${
            this.channelProfile.channelAuthValues == null ? "missing" : "invalid"
          }.`
        );
      } else {
        if (!this.isNonEmptyString(this.channelProfile.channelAuthValues.company_id)) {
          errors.push(
            `The channelProfile.channelAuthValues.company_id string is ${
              this.channelProfile.channelAuthValues.company_id == null ? "missing" : "invalid"
            }.`
          );
        }
        if (!this.isNonEmptyString(this.channelProfile.channelAuthValues.location_id)) {
          errors.push(
            `The channelProfile.channelAuthValues.location_id string is ${
              this.channelProfile.channelAuthValues.location_id == null ? "missing" : "invalid"
            }.`
          );
        }
        if (!this.isNonEmptyString(this.channelProfile.channelAuthValues.access_token)) {
          errors.push(
            `The channelProfile.channelAuthValues.access_token string is ${
              this.channelProfile.channelAuthValues.access_token == null ? "missing" : "invalid"
            }.`
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`ChannelProfile validation failed: ${JSON.stringify(errors)}`);
    }
  }

  validateQueryDoc(doc) {
    const errors = [];
    let queryType;
    this.debug(`Validating queryDoc: ${JSON.stringify(doc)}`);

    if (doc.remoteIDs && (!doc.modifiedDateRange && !doc.createdDateRange)) {
      queryType = "remoteIDs";

      if (!this.isNonEmptyArray(doc.remoteIDs)) {
        errors.push("The remoteIDs property must be an array with at least 1 value.");
      }
    } else if (doc.modifiedDateRange && (!doc.remoteIDs && !doc.createdDateRange)) {
      queryType = "modifiedDateRange";

      if (
        !moment(doc.modifiedDateRange.startDateGMT).isValid() ||
        !moment(doc.modifiedDateRange.endDateGMT).isValid()
      ) {
        errors.push("modifiedDateRange query requires valid startDateGMT and endDateGMT properties.");
      } else {
        if (!moment(doc.modifiedDateRange.startDateGMT).isBefore(doc.modifiedDateRange.endDateGMT)) {
          errors.push("startDateGMT must come before endDateGMT.");
        }
      }
    } else if (doc.createdDateRange && (!doc.modifiedDateRange && !doc.remoteIDs)) {
      queryType = "createdDateRange";

      if (!moment(doc.createdDateRange.startDateGMT).isValid() || !moment(doc.createdDateRange.endDateGMT).isValid()) {
        errors.push("createdDateRange query requires valid startDateGMT and endDateGMT properties.");
      } else {
        if (!moment(doc.createdDateRange.startDateGMT).isBefore(doc.createdDateRange.endDateGMT)) {
          errors.push("startDateGMT must come before endDateGMT.");
        }
      }
    } else {
      errors.push("QueryDoc must contain one (and only one) of remoteIDs, modifiedDateRange, or createdDateRange.");
    }

    if (errors.length > 0) {
      throw new Error(`QueryDoc validation failed: ${JSON.stringify(errors)}`);
    }

    return queryType;
  }

  getBaseUrl(endpointName) {
    if (!this.isNonEmptyString(endpointName)) {
      throw new TypeError("Argument must be a non empty string.");
    }

    return `${this.protocol}://${endpointName}${this.environment}.iqmetrix.net`;
  }

  handleError(err) {
    this.error(err.message);
    if (err.name === "StatusCodeError") {
      if (err.statusCode >= 500) {
        return 500;
      } else if (err.statusCode === 429) {
        this.warn("Request was throttled.");
        return 429;
      } else if (err.statusCode === 404) {
        this.warn("Existing document not found.");
        return 404;
      } else if (err.statusCode === 401) {
        this.warn("Expired/Invalid auth token.");
        return 401;
      }
    } else if (err.name === "RequestError") {
      return 500;
    }
    return 400;
  }

  isFunction(func) {
    return typeof func === "function";
  }

  isNonEmptyString(str) {
    return this.isString(str) && str.trim().length > 0;
  }

  isString(str) {
    return typeof str === "string";
  }

  isObject(obj) {
    return typeof obj === "object" && obj != null && !this.isArray(obj) && !this.isFunction(obj);
  }

  isNonEmptyObject(obj) {
    return this.isObject(obj) && Object.keys(obj).length > 0;
  }

  isArray(arr) {
    return Array.isArray(arr);
  }

  isNonEmptyArray(arr) {
    return this.isArray(arr) && arr.length > 0;
  }

  isNumber(num) {
    return typeof num === "number" && !isNaN(num);
  }

  isInteger(int) {
    return this.isNumber(int) && int % 1 === 0;
  }
}

module.exports = iqmetrix_dropship_channel;
