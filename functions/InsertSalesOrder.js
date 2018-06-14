function InsertSalesOrder(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["salesOrderBusinessReferences"];
    const stub = new nc.Stub("InsertSalesOrder", referenceLocations, ...arguments);

    const response = {
        dropship: {},
        process: {},
        salesOrder: {}
    };

    validateFunction()
        .then(getCustomerIds)
        .then(getItemIds)
        .then(postDropShipOrder)
        .then(processOrder)
        .then(postSalesOrder)
        .then(buildResponseObject)
        .catch(handleError)
        .then(() => callback(stub.out))
        .catch(error => {
            logError(`The callback function threw an exception: ${error}`);
            setTimeout(() => {
                throw error;
            });
        });

    function logInfo(msg) {
        stub.log(msg, "info");
    }

    function logWarn(msg) {
        stub.log(msg, "warn");
    }

    function logError(msg) {
        stub.log(msg, "error");
    }

    async function validateFunction() {
        if (stub.messages.length === 0) {
            if (!nc.isNonEmptyString(stub.channelProfile.channelSettingsValues.canPostInvoice)) {
                stub.messages.push(
                    `The channelProfile.channelSettingsValues.canPostInvoice string is ${
                        stub.channelProfile.channelSettingsValues.canPostInvoice == null ? "missing" : "invalid"
                    }.`
                );
            }
        }

        if (stub.messages.length > 0) {
            stub.messages.forEach(msg => logError(msg));
            stub.out.ncStatusCode = 400;
            throw new Error(`Invalid request [${stub.messages.join(" ")}]`);
        }

        logInfo("Function is valid.");
    }

    async function getCustomerIds() {
        if (nc.isNonEmptyString(stub.payload.billingCustomerRemoteID)) {
            logInfo(`Adding payload.billingCustomerRemoteID [${stub.payload.billingCustomerRemoteID}] to order.`);
            stub.payload.doc.DropshipOrder.BillingCustomerId =
                stub.payload.billingCustomerRemoteID || stub.payload.customerRemoteID;
        }
        if (nc.isNonEmptyString(stub.payload.billingAddressRemoteID)) {
            logInfo(`Adding payload.billingAddressRemoteID [${stub.payload.billingAddressRemoteID}] to order.`);
            stub.payload.doc.DropshipOrder.BillingAddressId = stub.payload.billingAddressRemoteID;
            stub.payload.doc.SalesOrder.BillingAddressId = stub.payload.billingAddressRemoteID;
        }
        if (nc.isNonEmptyString(stub.payload.shippingCustomerRemoteID)) {
            logInfo(`Adding payload.shippingCustomerRemoteID [${stub.payload.shippingCustomerRemoteID}] to order.`);
            stub.payload.doc.DropshipOrder.ShippingCustomerId =
                stub.payload.shippingCustomerRemoteID || stub.payload.customerRemoteID;
        }
        if (nc.isNonEmptyString(stub.payload.shippingAddressRemoteID)) {
            logInfo(`Adding payload.shippingAddressRemoteID [${stub.payload.shippingAddressRemoteID}] to order.`);
            stub.payload.doc.DropshipOrder.ShippingAddressId = stub.payload.shippingAddressRemoteID;
            stub.payload.doc.SalesOrder.ShippingAddressId = stub.payload.shippingAddressRemoteID;
        }
        if (nc.isNonEmptyString(stub.payload.customerRemoteID)) {
            logInfo(`Adding payload.customerRemoteID [${stub.payload.customerRemoteID}] to order.`);
            stub.payload.doc.SalesOrder.CustomerId = stub.payload.customerRemoteID;
        }
    }

    async function getItemIds() {
        const catalog = [];

        stub.payload.doc.DropshipOrder.Items.forEach(item => {
            if (
                catalog.findIndex(cat => cat.vendorSku === item.SKU && cat.supplierId === item.SupplierEntityId) === -1
            ) {
                catalog.push({ vendorSku: item.SKU, supplierId: item.SupplierEntityId });
            }
        });
        stub.payload.doc.SalesOrder.Items.forEach(item => {
            if (
                catalog.findIndex(
                    cat => cat.vendorSku === item.CorrelationId && cat.supplierId === item.SupplierEntityId
                ) === -1
            ) {
                catalog.push({ vendorSku: item.CorrelationId, supplierId: item.SupplierEntityId });
            }
        });

        logInfo("Getting product catalog ids...");
        //catalog.forEach(async cat => {
        //    cat.catalogId = await getItemId(cat.vendorSku, cat.supplierId);
        //});

        const catalogIds = await Promise.all(catalog.map(getItemId));

        stub.payload.doc.DropshipOrder.Items.forEach(item => {
            item.ProductId = catalogIds.find(
                cat => cat.vendorSku === item.SKU && cat.supplierId === item.SupplierEntityId
            ).catalogId;
        });
        stub.payload.doc.SalesOrder.Items.forEach(item => {
            item.ProductCatalogId = catalogIds.find(
                cat => cat.vendorSku === item.CorrelationId && cat.supplierId === item.SupplierEntityId
            ).catalogId;
        });
    }

    async function getItemId({ vendorSku, supplierId }) {
        const itemResponse = await stub.request.get({
            url: `https://catalogs${stub.channelProfile.channelSettingsValues.environment}.iqmetrix.net/v1/Companies(${
                stub.channelProfile.channelAuthValues.company_id
            })/Catalog/Items/ByVendorSku`,
            qs: {
                vendorsku: vendorSku,
                vendorid: supplierId
            }
        });

        if (nc.isArray(itemResponse.body.Items) && itemResponse.body.Items.length > 0) {
            if (itemResponse.body.Items.length === 1) {
                logInfo(
                    `Found catalog id '${
                        itemResponse.body.Items[0].CatalogItemId
                    }' for vendorSku = '${vendorSku}' supplierId = '${supplierId}'`
                );
                return {
                    catalogId: itemResponse.body.Items[0].CatalogItemId,
                    vendorSku: vendorSku,
                    supplierId: supplierId
                };
            } else {
                throw new Error(
                    `Found multiple catalog ids for vendorSku = '${vendorSku}' supplierId = '${supplierId}'.  Response: ${
                        itemResponse.body
                    }`
                );
            }
        } else {
            throw new Error(
                `Unable to find catalog id for vendorSku = '${vendorSku}' and supplierId = '${supplierId}'.  Response: ${
                    itemResponse.body
                }`
            );
        }
    }

    async function postDropShipOrder() {
        try {
            logInfo("Posting dropship order...");
            response.dropship = await stub.request.post({
                url: `https://order${stub.channelProfile.channelSettingsValues.environment}.iqmetrix.net/v1/Companies(${
                    stub.channelProfile.channelAuthValues.company_id
                })/OrderFull`,
                body: stub.payload.doc.DropshipOrder
            });
            logInfo(`Successfully posted dropship order (id = ${response.dropship.body.Id}).`);
        } catch (error) {
            logError("Error posting dropship order.");
            throw error;
        }
    }

    async function processOrder() {
        try {
            logInfo("Processing dropship order...");
            response.process = await stub.request.post({
                url: `https://order${stub.channelProfile.channelSettingsValues.environment}.iqmetrix.net/v1/Companies(${
                    stub.channelProfile.channelAuthValues.company_id
                })/Orders(${response.dropship.body.Id})/Process`,
                body: {
                    OrderId: response.dropship.body.Id
                }
            });
            logInfo(`Successfully processed dropship order (id = ${response.process.body.Id}).`);
        } catch (error) {
            logError("Error processing dropship order.");
            stub.out.ncStatusCode = 500;
            throw error;
        }
    }

    async function postSalesOrder() {
        try {
            logInfo("Posting sales order...");
            stub.payload.doc.SalesOrder.DropshipOrderId = response.dropship.body.Id;
            response.salesOrder = await stub.request.post({
                url: `https://salesorder${
                    stub.channelProfile.channelSettingsValues.environment
                }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/${
                    stub.channelProfile.channelSettingsValues.canPostInvoice
                }`,
                body: stub.payload.doc.SalesOrder
            });
            logInfo(`Successfully posted sales order (id = ${response.salesOrder.body.Id}).`);
        } catch (error) {
            logError("Error posting sales order.");
            stub.out.ncStatusCode = 500;
            throw error;
        }
    }

    async function buildResponseObject() {
        stub.out.response.endpointStatusCode = response.dropship.statusCode;
        stub.out.ncStatusCode = response.dropship.statusCode;
        stub.out.payload.salesOrderRemoteID = response.dropship.body.Id;
        stub.out.payload.salesOrderBusinessReference = nc.extractBusinessReferences(
            stub.channelProfile.salesOrderBusinessReferences,
            { DropshipOrder: response.dropship.body }
        );
    }

    async function handleError(error) {
        logError(error);
        if (error.name === "StatusCodeError") {
            stub.out.response.endpointStatusCode = error.statusCode;
            stub.out.response.endpointStatusMessage = error.message;
            if (!stub.out.ncStatusCode){
                if (error.statusCode >= 500) {
                    stub.out.ncStatusCode = 500;
                }
                else if (error.statusCode === 429) {
                    logWarn("Request was throttled.");
                    stub.out.ncStatusCode = 429;
                }
                else {
                    stub.out.ncStatusCode = 400;
                }
            }
        }
        stub.out.payload.error = error;
        stub.out.ncStatusCode = stub.out.ncStatusCode || 500;
    }
}

module.exports.InsertSalesOrder = InsertSalesOrder;
