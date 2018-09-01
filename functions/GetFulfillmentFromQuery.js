module.exports.GetFulfillmentFromQuery = (ncUtil, channelProfile, flowContext, payload, callback) => {
  const stubName = "GetFulfillmentFromQuery";
  const referenceLocations = ["fulfillmentBusinessReferences", "salesOrderBusinessReferences"];
  const nc = require("./util/ncUtils");
  let companyId, page, pageSize, totalResults;
  const stub = new nc.Stub(stubName, referenceLocations, ncUtil, channelProfile, flowContext, payload, callback);

  initializeStubFunction()
    .then(searchForOrders)
    .then(buildResponseObject)
    .catch(handleError)
    .then(() => callback(stub.out))
    .catch(error => {
      logError(`The callback function threw an exception: ${error}`);
      setTimeout(() => {
        throw error;
      });
    });

  async function initializeStubFunction() {
    if (!stub.isValid) {
      stub.messages.forEach(msg => logError(msg));
      stub.out.ncStatusCode = 400;
      throw new Error(`Invalid request [${stub.messages.join(" ")}]`);
    }

    logInfo("Stub function is valid.");

    companyId = stub.channelProfile.channelAuthValues.company_id;
    page = stub.payload.doc.page;
    pageSize = stub.payload.doc.pageSize;

    return JSON.parse(JSON.stringify(stub.payload.doc));
  }

  async function searchForOrders(queryDoc) {
    const filters = [`companyId eq ${companyId}`];
    let orders = [];

    switch (stub.queryType) {
      case "remoteIDs": {
        orders = await remoteIdSearch(queryDoc.remoteIDs);
        break;
      }

      case "createdDateRange": {
        filters.push(`createdUtc gt ${new Date(Date.parse(queryDoc.createdDateRange.startDateGMT) - 1).toISOString()}`);
        filters.push(`createdUtc lt ${new Date(Date.parse(queryDoc.createdDateRange.endDateGMT) + 1).toISOString()}`);
        orders = await dateRangeSearch(filters);
        break;
      }

      case "modifiedDateRange": {
        filters.push(
          `updatedUtc gt ${new Date(Date.parse(queryDoc.modifiedDateRange.startDateGMT) - 1).toISOString()}`
        );
        filters.push(`updatedUtc lt ${new Date(Date.parse(queryDoc.modifiedDateRange.endDateGMT) + 1).toISOString()}`);
        orders = await dateRangeSearch(filters);
        break;
      }

      default: {
        stub.out.ncStatusCode = 400;
        throw new Error(`Invalid request, unknown query type: '${stub.queryType}'`);
      }
    }
    return orders;
  }

  async function remoteIdSearch(remoteIds) {
    remoteIds = [...new Set(remoteIds)];
    totalResults = remoteIds.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = page * pageSize;
    const orders = [];
    for (const remoteId of remoteIds.slice(startIndex, endIndex)) {
      const order = await getOrderDetail(remoteId);
      order.orderFull = await getOrderFull(order.invoiceNumber);
      orders.push(order);
    }
    return orders;
  }

  async function dateRangeSearch(filters) {
    const orderReport = await getOrderReport(filters);
    totalResults = orderReport.totalRecords;
    const orders = [];
    for (const row of orderReport.rows) {
      const order = await getOrderDetail(row._id);
      order.orderFull = await getOrderFull(order.invoiceNumber);
      orders.push(order);
    }
    return orders;
  }

  async function getOrderReport(filters) {
    const filter = filters.join(" and ");
    logInfo(`Getting order report with filter: '${filter}'`);

    const req = stub.requestPromise.get(
      Object.assign({}, stub.requestDefaults, {
        method: "GET",
        baseUrl: stub.getBaseUrl("ordermanagementreporting"),
        url: "/v1/Reports/OrderList/report",
        qs: {
          filter: filter,
          page: page,
          pageSize: pageSize,
          sortBy: "createdUtc",
          sortOrder: "asc"
        }
      })
    );
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`Order report request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!resp.body || !nc.isArray(resp.body.rows) || !nc.isNumber(resp.body.totalRecords)) {
      throw new TypeError(
        "Order report response is not in expected format, expected rows[] and totalRecords properties."
      );
    }

    logInfo(`Order report response contains ${resp.body.rows.length} of ${resp.body.totalRecords} records.`);

    return resp.body;
  }

  async function getOrderDetail(orderId) {
    logInfo(`Getting order detail for order '${orderId}'`);

    const req = stub.requestPromise.get(
      Object.assign({}, stub.requestDefaults, {
        method: "GET",
        baseUrl: stub.getBaseUrl("ordermanagementreporting"),
        url: `/v1/Companies(${companyId})/OrderDetails(${orderId})`
      })
    );
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`Order detail request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!resp.body || !resp.body.id || !resp.body.invoiceNumber) {
      throw new TypeError("Order detail response is not in expected format, expected id and invoiceNumber properties.");
    }

    return resp.body;
  }

  async function getOrderFull(orderId) {
    logInfo(`Getting order full details for order '${orderId}'`);

    const req = stub.requestPromise.get(
      Object.assign({}, stub.requestDefaults, {
        method: "GET",
        baseUrl: stub.getBaseUrl("order"),
        url: `/v1/Companies(${companyId})/OrderFull`,
        qs: {
          $filter: `PrintableId eq '${orderId}'`
        }
      })
    );
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`Order full details request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (!nc.isArray(resp.body) || resp.body.length > 1) {
      throw new TypeError(
        "Order full details response is not in expected format, expected an array with 1 or 0 objects."
      );
    }

    if (resp.body.length === 0) {
      throw new TypeError("Order full details response did not contain any results.");
    }

    if (resp.body.length > 1) {
      throw new TypeError("Order full details response contains multiple results.");
    }

    return resp.body[0];
  }

  async function buildResponseObject(orderFulfillments) {
    if (orderFulfillments.length > 0) {
      logInfo(`Submitting ${orderFulfillments.length} order fulfillments...`);

      stub.out.payload = [];
      orderFulfillments.forEach(orderFulfillment => {
        stub.out.payload.push({
          doc: orderFulfillment,
          fulfillmentRemoteID: orderFulfillment.id,
          fulfillmentBusinessReference: nc.extractBusinessReferences(
            stub.channelProfile.fulfillmentBusinessReferences,
            orderFulfillment
          ),
          salesOrderRemoteID: orderFulfillment.dropshipOrderItems[0].dropshipOrderId,
          salesOrderBusinessReference: nc.extractBusinessReferences(
            stub.channelProfile.salesOrderBusinessReferences,
            orderFulfillment
          )
        });
      });

      stub.out.ncStatusCode = page * pageSize <= totalResults ? 206 : 200;
    } else {
      logInfo("No order fulfillments found.");
      stub.out.ncStatusCode = 204;
    }

    return stub.out;
  }

  async function handleError(error) {
    logError(error);
    if (error.name === "StatusCodeError") {
      stub.out.response.endpointStatusCode = error.statusCode;
      stub.out.response.endpointStatusMessage = error.message;

      if (error.statusCode >= 500) {
        stub.out.ncStatusCode = 500;
      } else if ([429, 401].includes(error.statusCode)) {
        stub.out.ncStatusCode = error.statusCode;
      } else {
        stub.out.ncStatusCode = 400;
      }
    }
    stub.out.payload.error = error;
    stub.out.ncStatusCode = stub.out.ncStatusCode || 500;

    return stub.out;
  }

  function logInfo(msg) {
    stub.log(msg, "info");
  }

  function logWarn(msg) {
    stub.log(msg, "warn");
  }

  function logError(msg) {
    stub.log(msg, "error");
  }
};
