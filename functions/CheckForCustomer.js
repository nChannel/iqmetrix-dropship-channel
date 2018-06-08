function CheckForCustomer(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["customerBusinessReferences"];
    const stub = new nc.Stub("CheckForCustomer", referenceLocations, ...arguments);

    validateFunction()
        .then(searchForCustomer)
        .then(buildResponse)
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
        if (stub.messages.length > 0) {
            stub.messages.forEach(msg => logError(msg));
            stub.out.ncStatusCode = 400;
            throw new Error(`Invalid request [${stub.messages.join(" ")}]`);
        }
        logInfo("Function is valid.");
    }

    async function searchForCustomer() {
        logInfo("Searching for existing customer...");

        const filters = [];
        stub.channelProfile.customerBusinessReferences.forEach(refName => {
            const refValue = nc.extractBusinessReferences([refName], stub.payload.doc);
            filters.push(`${refName} eq '${refValue}'`);
        });

        return await stub.request.get({
            url: `${stub.channelProfile.channelSettingsValues.protocol}://crm${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Customers`,
            qs: { $filter: filters.join(" and ") }
        });
    }

    async function buildResponse(response) {
        const customers = response.body;
        stub.out.response.endpointStatusCode = response.statusCode;

        if (!nc.isArray(customers)) {
            throw new TypeError(`Search response is not an array. Response: ${JSON.stringify(customers, null, 2)}`);
        }

        if (customers.length === 1) {
            if (!nc.isObject(customers[0]) || !nc.isNonEmptyString(customers[0].Id)) {
                throw new TypeError(
                    `Search response is not in expected format. Response: ${JSON.stringify(customers[0], null, 2)}`
                );
            }
            logInfo("Found a matching customer.");
            stub.out.ncStatusCode = 200;
            stub.out.payload.customerRemoteID = customers[0].Id;
            stub.out.payload.customerBusinessReference = nc.extractBusinessReferences(
                stub.channelProfile.customerBusinessReferences,
                customers[0]
            );
        } else if (customers.length === 0) {
            logInfo("Customer does not exist.");
            stub.out.ncStatusCode = 204;
        } else {
            logWarn("Multiple customers matched query.");
            stub.out.payload.error = new Error(
                `Search returned multiple customers. Response: ${JSON.stringify(customers, null, 2)}`
            );
            stub.out.ncStatusCode = 409;
        }
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
                stub.out.ncStatusCode = 429;
            } else {
                stub.out.ncStatusCode = 400;
            }
        }
        stub.out.payload.error = error;
        stub.out.ncStatusCode = stub.out.ncStatusCode || 500;
    }
}

module.exports.CheckForCustomer = CheckForCustomer;
