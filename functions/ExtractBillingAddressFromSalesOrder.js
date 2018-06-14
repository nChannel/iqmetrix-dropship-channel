function ExtractBillingAddressFromSalesOrder(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["salesOrderBusinessReferences"];
    const stub = new nc.Stub("ExtractBillingAddressFromSalesOrder", referenceLocations, ...arguments);

    validateFunction()
        .then(extractBillingAddress)
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

    async function extractBillingAddress() {
        logInfo("Extracting billing address...");

        if (nc.isNonEmptyObject(stub.payload.doc.BillingAddress)) {
            stub.out.payload.doc = stub.payload.doc.BillingAddress;
            stub.out.ncStatusCode = 200;
        } else {
            logWarn("No billing address found.");
            stub.out.ncStatusCode = 204;
        }
    }

    async function handleError(error) {
        logError(error);
        stub.out.payload.error = error;
        stub.out.ncStatusCode = stub.out.ncStatusCode || 500;
    }
}

module.exports.ExtractBillingAddressFromSalesOrder = ExtractBillingAddressFromSalesOrder;
