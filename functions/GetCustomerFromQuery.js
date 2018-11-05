module.exports.GetCustomerFromQuery = (ncUtil, channelProfile, flowContext, payload, callback) => {
  const stubName = "GetCustomerFromQuery";
  const referenceLocations = [
    "customerBusinessReferences",
    "customerAddressBusinessReferences",
    "customerContactBusinessReferences"
  ];
  const nc = require("./util/ncUtils");
  let companyId, page, pageSize, totalResults, hasMore;
  const stub = new nc.Stub(stubName, referenceLocations, ncUtil, channelProfile, flowContext, payload, callback);

  initializeStubFunction()
    .then(searchForCustomers)
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

  async function searchForCustomers(queryDoc) {
    let customers = [];

    switch (stub.queryType) {
      case "remoteIDs": {
        customers = await remoteIdSearch(queryDoc);
        hasMore = page * pageSize <= totalResults;
        break;
      }

      case "createdDateRange": {
        logWarn("Searching by createdDateRange is not supported, will search on modifiedDateRange instead.");
        queryDoc.modifiedDateRange = queryDoc.createdDateRange;
      }
      case "modifiedDateRange": {
        logWarn("EndDate will be ignored when searching on modified date range (will use StartDate to Now).");
        customers = await modifiedDateRangeSearch(queryDoc);
        hasMore = !(customers.length < pageSize);
        break;
      }

      default: {
        stub.out.ncStatusCode = 400;
        throw new Error(`Invalid request, unknown query type: '${stub.queryType}'`);
      }
    }

    return customers;
  }

  async function remoteIdSearch(queryDoc) {
    const remoteIds = [...new Set(queryDoc.remoteIDs)];
    totalResults = remoteIds.length;

    const startIndex = (page - 1) * pageSize;
    const endIndex = page * pageSize;
    const customers = [];

    for (const remoteId of remoteIds.slice(startIndex, endIndex)) {
      const customer = await getCustomerFullById(remoteId);
      if (customer != null) {
        customers.push(customer);
      }
    }

    return customers;
  }

  async function modifiedDateRangeSearch(queryDoc) {
    const startDate = new Date(Date.parse(queryDoc.modifiedDateRange.startDateGMT)).toISOString();
    const customers = await getCustomerFullByModifiedDate(startDate);

    return customers;
  }

  async function getCustomerFullById(customerId) {
    const customerFull = await getCustomerFull(customerId);
    return customerFull;
  }

  async function getCustomerFullByModifiedDate(startDate) {
    const customerFull = await getCustomerFull(null, startDate);
    return customerFull;
  }

  async function getCustomerFull(customerId, startDate) {
    logInfo("Getting Customer(s) from iQmetrix..");
    let url = `/v1/Companies(${companyId})/CustomerFull`;
    let qs = {};

    if (customerId != null) {
      url += `(${customerId})`;
    } else if (startDate != null) {
      qs = {
        $filter: `LastModifiedDateUtc ge datetime'${startDate}'`,
        $skip: (page - 1) * pageSize,
        $top: pageSize
      };
    } else {
      throw new TypeError("One of customerId or startDate must be provided.");
    }

    const req = stub.requestPromise.get(
      Object.assign({}, stub.requestDefaults, {
        method: "GET",
        baseUrl: stub.getBaseUrl("crm"),
        url: url,
        qs: qs
      })
    );
    logInfo(`Calling: ${req.method} ${req.uri.href}`);

    const resp = await req;
    stub.out.response.endpointStatusCode = resp.statusCode;
    stub.out.response.endpointStatusMessage = resp.statusMessage;

    if (resp.timingPhases) {
      logInfo(`CustomerFull request completed in ${Math.round(resp.timingPhases.total)} milliseconds.`);
    }

    if (customerId != null) {
      if (!resp.body || !resp.body.Id) {
        throw new TypeError("CustomerFull response is not in expected format, expected Id property.");
      }
    }
    if (startDate != null) {
      if (!resp.body || !nc.isArray(resp.body)) {
        throw new TypeError("CustomerFull response is not in expected format, expected an array.");
      }
    }

    return resp.body;
  }

  async function buildResponseObject(customers) {
    if (customers.length > 0) {
      logInfo(`Submitting ${customers.length} Customer(s)...`);

      stub.out.payload = [];
      customers.forEach(customer => {
        stub.out.payload.push({
          doc: customer,
          customerRemoteID: customer.Id,
          customerBusinessReference: nc.extractBusinessReferences(
            stub.channelProfile.customerBusinessReferences,
            customer
          )
        });
      });

      stub.out.ncStatusCode = hasMore ? 206 : 200;
    } else {
      logInfo("No customers found.");
      stub.out.ncStatusCode = hasMore ? 206 : 204;
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
      } else if (error.statusCode === 429) {
        logWarn("Request was throttled.");
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
