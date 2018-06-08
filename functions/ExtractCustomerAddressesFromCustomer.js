function ExtractCustomerAddressesFromCustomer(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["customerBusinessReferences"];
    const stub = new nc.Stub("ExtractCustomerAddressesFromCustomer", referenceLocations, ...arguments);

    validateFunction()
        .then(extractCustomerAddresses)
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

    async function extractCustomerAddresses() {
        logInfo("Extracting customer addresses...");

        if (nc.isNonEmptyArray(stub.payload.doc.Addresses)) {
            stub.out.payload = stub.payload.doc.Addresses.map(address => {
                return {
                    doc: address,
                    customerRemoteID: stub.payload.customerRemoteID,
                    customerBusinessReference: stub.payload.customerBusinessReference
                };
            });
            stub.out.ncStatusCode = 200;
        } else {
            logWarn("No customer addresses found.");
            stub.out.ncStatusCode = 204;
        }
    }

    async function handleError(error) {
        logError(error);
        stub.out.payload.error = error;
        stub.out.ncStatusCode = stub.out.ncStatusCode || 500;
    }
}

module.exports.ExtractCustomerAddressesFromCustomer = ExtractCustomerAddressesFromCustomer;
