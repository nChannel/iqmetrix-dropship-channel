function CheckForCustomerContact(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require("./util/ncUtils");
    const referenceLocations = ["customerContactBusinessReferences"];
    const stub = new nc.Stub("CheckForCustomerContact", referenceLocations, ...arguments);

    validateFunction()
        .then(searchForCustomerContact)
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

    async function searchForCustomerContact() {
        logInfo("Searching for existing customer contact...");

        return await stub.request.get({
            url: `${stub.channelProfile.channelSettingsValues.protocol}://crm${
                stub.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net/v1/Companies(${stub.channelProfile.channelAuthValues.company_id})/Customers(${
                stub.payload.doc.CustomerId
            })/ContactMethods`
        });
    }

    async function buildResponse(response) {
        const contactMethods = response.body;
        stub.out.response.endpointStatusCode = response.statusCode;

        if (!nc.isArray(contactMethods)) {
            throw new TypeError(
                `Search response is not an array. Response: ${JSON.stringify(contactMethods, null, 2)}`
            );
        }
        if (contactMethods.length === 0) {
            logInfo("Customer does not have any existing contact methods.");
            stub.out.ncStatusCode = 204;
        }

        const baseReference = nc.extractBusinessReferences(
            stub.channelProfile.customerContactBusinessReferences,
            stub.payload.doc
        );
        const matchingContactMethods = [];
        contactMethods.forEach(contactMethod => {
            const contactMethodReference = nc.extractBusinessReferences(
                stub.channelProfile.customerContactBusinessReferences,
                contactMethod
            );
            if (contactMethodReference === baseReference) {
                matchingContactMethods.push(contactMethod);
            }
        });

        if (matchingContactMethods.length === 1) {
            logInfo("Found a matching contact method.");
            stub.out.ncStatusCode = 200;
            stub.out.payload.customerAddressRemoteID = matchingContactMethods[0].Id;
            stub.out.payload.customerAddressBusinessReference = nc.extractBusinessReferences(
                stub.channelProfile.customerContactBusinessReferences,
                matchingContactMethods[0]
            );
        } else if (matchingContactMethods.length === 0) {
            logInfo("No matching contact method found on customer.");
            stub.out.ncStatusCode = 204;
        } else {
            stub.out.payload.error = new Error(
                `Search returned multiple matching contact methods. Response: ${JSON.stringify(
                    matchingContactMethods,
                    null,
                    2
                )}`
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

module.exports.CheckForCustomerContact = CheckForCustomerContact;
