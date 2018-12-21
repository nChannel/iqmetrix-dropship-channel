"use strict";

module.exports = async function(flowContext, payload) {
  const output = {
    statusCode: 400,
    payload: {},
    errors: []
  };

  try {
    await getCustomerIds.bind(this)();
    await getItemIds.bind(this)();
    output.payload.DropshipOrder = await postDropShipOrder.bind(this)();
    output.payload.ProcessResult = await processOrder.bind(this)();
    output.payload.SalesOrder = await postSalesOrder.bind(this)();
    output.statusCode = 201;
    return output;
  } catch (err) {
    output.statusCode = this.handleError(err);
    output.endpointStatusCode = err.statusCode;
    output.errors.push(err);
    throw output;
  }

  async function getCustomerIds() {
    if (this.isNonEmptyString(payload.billingCustomerRemoteID)) {
      this.info(`Adding payload.billingCustomerRemoteID [${payload.billingCustomerRemoteID}] to order.`);
      payload.doc.DropshipOrder.BillingCustomerId = payload.billingCustomerRemoteID || payload.customerRemoteID;
    }
    if (this.isNonEmptyString(payload.billingAddressRemoteID)) {
      this.info(`Adding payload.billingAddressRemoteID [${payload.billingAddressRemoteID}] to order.`);
      payload.doc.DropshipOrder.BillingAddressId = payload.billingAddressRemoteID;
      payload.doc.SalesOrder.BillingAddressId = payload.billingAddressRemoteID;
    }
    if (this.isNonEmptyString(payload.shippingCustomerRemoteID)) {
      this.info(`Adding payload.shippingCustomerRemoteID [${payload.shippingCustomerRemoteID}] to order.`);
      payload.doc.DropshipOrder.ShippingCustomerId = payload.shippingCustomerRemoteID || payload.customerRemoteID;
    }
    if (this.isNonEmptyString(payload.shippingAddressRemoteID)) {
      this.info(`Adding payload.shippingAddressRemoteID [${payload.shippingAddressRemoteID}] to order.`);
      payload.doc.DropshipOrder.ShippingAddressId = payload.shippingAddressRemoteID;
      payload.doc.SalesOrder.ShippingAddressId = payload.shippingAddressRemoteID;
    }
    if (this.isNonEmptyString(payload.customerRemoteID)) {
      this.info(`Adding payload.customerRemoteID [${payload.customerRemoteID}] to order.`);
      payload.doc.SalesOrder.CustomerId = payload.customerRemoteID;
    }
  }

  async function getItemIds() {
    const catalog = [];

    payload.doc.DropshipOrder.Items.forEach(item => {
      if (catalog.findIndex(cat => cat.vendorSku === item.SKU && cat.supplierId === item.SupplierEntityId) === -1) {
        catalog.push({ vendorSku: item.SKU, supplierId: item.SupplierEntityId });
      }
    });
    payload.doc.SalesOrder.Items.forEach(item => {
      if (
        catalog.findIndex(cat => cat.vendorSku === item.CorrelationId && cat.supplierId === item.SupplierEntityId) ===
        -1
      ) {
        catalog.push({ vendorSku: item.CorrelationId, supplierId: item.SupplierEntityId });
      }
    });

    this.info("Getting product catalog ids...");
    const catalogIds = await Promise.all(catalog.map(getItemId.bind(this)));

    payload.doc.DropshipOrder.Items.forEach(item => {
      item.ProductId = catalogIds.find(
        cat => cat.vendorSku === item.SKU && cat.supplierId === item.SupplierEntityId
      ).catalogId;
    });
    payload.doc.SalesOrder.Items.forEach(item => {
      item.ProductCatalogId = catalogIds.find(
        cat => cat.vendorSku === item.CorrelationId && cat.supplierId === item.SupplierEntityId
      ).catalogId;
    });
  }

  async function getItemId({ vendorSku, supplierId }) {
    this.info(`Getting Item Id for vendorSku = '${vendorSku}' and supplierId = '${supplierId}'...`);
    const req = this.request({
      method: "GET",
      baseUrl: this.getBaseUrl("catalogs"),
      url: `/v1/Companies(${this.company_id})/Catalog/Items/ByVendorSku`,
      qs: {
        vendorsku: vendorSku,
        vendorid: supplierId
      }
    });

    const resp = await req;
    output.endpointStatusCode = resp.statusCode;

    if (resp.timingPhases) {
      this.info(`Item Id request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (this.isArray(resp.body.Items) && resp.body.Items.length > 0) {
      if (resp.body.Items.length === 1) {
        this.info(
          `Found catalog id '${
            resp.body.Items[0].CatalogItemId
          }' for vendorSku = '${vendorSku}' and supplierId = '${supplierId}'`
        );
        return {
          catalogId: resp.body.Items[0].CatalogItemId,
          vendorSku: vendorSku,
          supplierId: supplierId
        };
      } else {
        throw new Error(
          `Found multiple catalog ids for vendorSku = '${vendorSku}' supplierId = '${supplierId}'.  Response: ${
            resp.body
          }`
        );
      }
    } else {
      throw new Error(
        `Unable to find catalog id for vendorSku = '${vendorSku}' and supplierId = '${supplierId}'.  Response: ${
          resp.body
        }`
      );
    }
  }

  async function postDropShipOrder() {
    try {
      this.info("Posting dropship order...");

      const req = this.request({
        method: "POST",
        baseUrl: this.getBaseUrl("order"),
        url: `/v1/Companies(${this.company_id})/OrderFull`,
        body: payload.doc.DropshipOrder
      });

      const resp = await req;
      output.endpointStatusCode = resp.statusCode;

      if (resp.timingPhases) {
        this.info(`Posting dropship order request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
      }

      this.info(`Successfully posted dropship order (id = ${resp.body.Id}).`);
      return resp.body;
    } catch (error) {
      this.error("Error posting dropship order.");
      throw error;
    }
  }

  async function processOrder() {
    try {
      this.info("Processing dropship order...");

      const req = this.request({
        method: "POST",
        baseUrl: this.getBaseUrl("order"),
        url: `/v1/Companies(${this.company_id})/Orders(${output.payload.DropshipOrder.Id})/Process`,
        body: {
          OrderId: output.payload.DropshipOrder.Id
        }
      });

      const resp = await req;
      output.endpointStatusCode = resp.statusCode;

      if (resp.timingPhases) {
        this.info(
          `Processing dropship order request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`
        );
      }

      this.info(`Successfully processed dropship order (id = ${resp.body.Id}).`);
      return resp.body;
    } catch (error) {
      this.error("Error processing dropship order.");
      error.statusCode = 400;
      throw error;
    }
  }

  async function postSalesOrder() {
    try {
      this.info("Posting sales order...");
      payload.doc.SalesOrder.DropshipOrderId = output.payload.DropshipOrder.Id;

      const req = this.request({
        method: "POST",
        baseUrl: this.getBaseUrl("salesorder"),
        url: `/v1/Companies(${this.company_id})/${this.canPostInvoice}`,
        body: payload.doc.SalesOrder
      });

      const resp = await req;
      output.endpointStatusCode = resp.statusCode;

      if (resp.timingPhases) {
        this.info(`Posting sales order request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
      }

      this.info(`Successfully posted sales order (id = ${resp.body.Id}).`);
      return resp.body;
    } catch (error) {
      this.error("Error posting sales order.");
      error.statusCode = 400;
      throw error;
    }
  }
};
