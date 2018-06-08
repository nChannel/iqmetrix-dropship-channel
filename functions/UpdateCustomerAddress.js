function UpdateCustomerAddress(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["customerAddressBusinessReferences"];
    const stub = new nc.Stub("UpdateCustomerAddress", referenceLocations, ...arguments);

    validateFunction()
        .then(updateCustomerAddress)
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

    async function updateCustomerAddress() {
        logInfo("Updating existing customer address record...");

        return await stub.request.put({
            url: `${stub.channelProfile.channelSettingsValues.protocol}://crm${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Customers(${
                stub.payload.customerRemoteID
            })/Addresses(${stub.payload.customerAddressRemoteID})`,
            body: stub.payload.doc
        });
    }

    async function buildResponse(response) {
        const customerAddress = response.body;
        stub.out.response.endpointStatusCode = response.statusCode;
        stub.out.ncStatusCode = response.statusCode;
        stub.out.payload.customerAddressRemoteID = customerAddress.Id;
        stub.out.payload.customerAddressBusinessReference = nc.extractBusinessReferences(
            stub.channelProfile.customerAddressBusinessReferences,
            customerAddress
        );
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

module.exports.UpdateCustomerAddress = UpdateCustomerAddress;
