function CheckForCustomerAddress(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["customerAddressBusinessReferences"];
    const stub = new nc.Stub("CheckForCustomerAddress", referenceLocations, ...arguments);

    validateFunction()
        .then(searchForCustomerAddress)
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

    async function searchForCustomerAddress() {
        logInfo("Searching for existing customer address...");

        return await stub.request.get({
            url: `${stub.channelProfile.channelSettingsValues.protocol}://crm${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Customers(${
                stub.payload.doc.CustomerId
            })/Addresses`
        });
    }

    async function buildResponse(response) {
        const addresses = response.body;
        stub.out.response.endpointStatusCode = response.statusCode;

        if (!nc.isArray(addresses)) {
            throw new TypeError(`Search response is not an array. Response: ${JSON.stringify(addresses, null, 2)}`);
        }
        if (addresses.length === 0) {
            logInfo("Customer does not have any existing addresses.");
            stub.out.ncStatusCode = 204;
        }

        const baseReference = nc.extractBusinessReferences(
            stub.channelProfile.customerAddressBusinessReferences,
            stub.payload.doc
        );
        const matchingAddresses = [];
        addresses.forEach(address => {
            const addressReference = nc.extractBusinessReferences(
                stub.channelProfile.customerAddressBusinessReferences,
                address
            );
            if (addressReference === baseReference) {
                matchingAddresses.push(address);
            }
        });

        if (matchingAddresses.length === 1) {
            logInfo("Found a matching address.");
            stub.out.ncStatusCode = 200;
            stub.out.payload.customerAddressRemoteID = matchingAddresses[0].Id;
            stub.out.payload.customerAddressBusinessReference = nc.extractBusinessReferences(
                stub.channelProfile.customerAddressBusinessReferences,
                matchingAddresses[0]
            );
        } else if (matchingAddresses.length === 0) {
            logInfo("No matching address found on customer.");
            stub.out.ncStatusCode = 204;
        } else {
            stub.out.payload.error = new Error(
                `Search returned multiple matching addresses. Response: ${JSON.stringify(matchingAddresses, null, 2)}`
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

module.exports.CheckForCustomerAddress = CheckForCustomerAddress;
