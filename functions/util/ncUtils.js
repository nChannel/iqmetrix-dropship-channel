const requestPromise = require("request-promise");
const requestDebug = require("request-debug");
const jsonata = require("jsonata");
const moment = require("moment");

class Stub {
    constructor(name, referenceLocations, ncUtil, channelProfile, flowContext, payload, callback) {
        this.name = name;
        this.referenceLocations = referenceLocations;
        this.ncUtil = ncUtil;
        this.channelProfile = channelProfile;
        this.flowContext = flowContext;
        this.payload = payload;
        this.callback = callback;
        this.out = {
            ncStatusCode: null,
            response: {},
            payload: {}
        };
        this.queryType = null;
        this.messages = [];

        this.logInfo(`Beginning ${this.name}...`);

        this.validateCallback();
        this.validateNcUtil();
        this.validateChannelProfile();
        this.validateFlowContext();
        this.validatePayload();

        if (this.isValid) {
            this.requestPromise = requestPromise;
            this.requestDefaults = {
                auth: {
                    bearer: this.channelProfile.channelAuthValues.access_token
                },
                json: true,
                gzip: true,
                time: true,
                simple: true,
                resolveWithFullResponse: true
            };

            requestDebug(this.requestPromise, (type, data) => {
                if (data && (!data.headers || data.headers.host !== "localhost:4")) {
                    this.logDebug(
                        `${type}: ${JSON.stringify(data, (key, value) => {
                            if (key === "body") {
                                try {
                                    return JSON.parse(value);
                                } catch (e) {
                                    return value;
                                }
                            } else {
                                return value;
                            }
                        })}`
                    );
                }
            });
        }
    }

    get isValid() {
        return !isNonEmptyArray(this.messages);
    }

    log(msg, level = "info") {
        let prefix = `${new Date().toISOString()} [${level}]`;
        if (isNonEmptyString(this.name)) {
            prefix = `${prefix} ${this.name}`;
        }
        console.log(`${prefix} | ${msg}`);
    }

    logInfo(msg) {
        this.log(msg, "info");
    }

    logWarn(msg) {
        this.log(msg, "warn");
    }

    logError(msg) {
        this.log(msg, "error");
    }

    logDebug(msg) {
        this.log(msg, "debug");
    }

    validateCallback() {
        this.logDebug(`Validating callback: ${this.callback}`);

        // Fail immediately if the callback function is missing or invalid.
        if (!isFunction(this.callback)) {
            this.logError(`The callback function is ${this.callback == null ? "missing" : "invalid"}.`);
            if (this.callback == null) {
                throw new Error("A callback function was not provided");
            }
            throw new TypeError("callback is not a function");
        }
    }

    validateNcUtil() {
        this.logDebug(`Validating ncUtil: ${JSON.stringify(this.ncUtil)}`);
        if (!isObject(this.ncUtil)) {
            this.messages.push(`The ncUtil object is ${this.ncUtil == null ? "missing" : "invalid"}.`);
        }
    }

    validateFlowContext() {
        this.logDebug(`Validating flowContext: ${JSON.stringify(this.flowContext)}`);
    }

    validatePayload() {
        this.logDebug(`Validating payload: ${JSON.stringify(this.payload)}`);
        if (!isObject(this.payload)) {
            this.messages.push(`The payload object is ${this.payload == null ? "missing" : "invalid"}.`);
        } else {
            if (!isObject(this.payload.doc)) {
                this.messages.push(`The payload.doc object is ${this.payload.doc == null ? "missing" : "invalid"}.`);
            } else {
                if (this.name.startsWith("Get") && this.name.endsWith("FromQuery")) {
                    this.validateQueryDoc(this.payload.doc);
                }
            }
        }
    }

    validateQueryDoc(doc) {
        if (doc.remoteIDs && (!doc.searchFields && !doc.modifiedDateRange && !doc.createdDateRange)) {
            this.queryType = "remoteIDs";

            if (!isNonEmptyArray(doc.remoteIDs)) {
                this.messages.push("The remoteIDs property must be an array with at least 1 value.");
            }
        } else if (doc.searchFields && (!doc.remoteIDs && !doc.modifiedDateRange && !doc.createdDateRange)) {
            this.queryType = "searchFields";

            if (!isNonEmptyArray(doc.searchFields)) {
                this.messages.push("The searchFields property must be an array with at least 1 key value pair object.");
            } else {
                if (
                    !doc.searchFields.every(
                        searchField => isNonEmptyString(searchField.searchField) && isNonEmptyArray(searchField.searchValues)
                    )
                ) {
                    this.messages.push(
                        "searchFields array elements must be in the form: { searchField: 'key', searchValues: ['value_1'] }."
                    );
                }
            }
        } else if (doc.modifiedDateRange && (!doc.searchFields && !doc.remoteIDs && !doc.createdDateRange)) {
            this.queryType = "modifiedDateRange";

            if (
                !moment(doc.modifiedDateRange.startDateGMT).isValid() ||
                !moment(doc.modifiedDateRange.endDateGMT).isValid()
            ) {
                this.messages.push("modifiedDateRange query requires valid startDateGMT and endDateGMT properties.");
            } else {
                if (!moment(doc.modifiedDateRange.startDateGMT).isBefore(doc.modifiedDateRange.endDateGMT)) {
                    this.messages.push("startDateGMT must come before endDateGMT.");
                }
            }
        } else if (doc.createdDateRange && (!doc.searchFields && !doc.modifiedDateRange && !doc.remoteIDs)) {
            this.queryType = "createdDateRange";

            if (!moment(doc.createdDateRange.startDateGMT).isValid() || !moment(doc.createdDateRange.endDateGMT).isValid()) {
                this.messages.push("createdDateRange query requires valid startDateGMT and endDateGMT properties.");
            } else {
                if (!moment(doc.createdDateRange.startDateGMT).isBefore(doc.createdDateRange.endDateGMT)) {
                    this.messages.push("startDateGMT must come before endDateGMT.");
                }
            }
        } else {
            this.messages.push(
                "Query doc must contain one (and only one) of remoteIDs, searchFields, modifiedDateRange, or createdDateRange."
            );
        }
    }

    validateChannelProfile() {
        this.logDebug(`Validating channelProfile: ${JSON.stringify(this.channelProfile)}`);
        if (!isObject(this.channelProfile)) {
            this.messages.push(`The channelProfile object is ${this.channelProfile == null ? "missing" : "invalid"}.`);
        } else {
            if (!isObject(this.channelProfile.channelSettingsValues)) {
                this.messages.push(
                    `The channelProfile.channelSettingsValues object is ${
                    this.channelProfile.channelSettingsValues == null ? "missing" : "invalid"
                    }.`
                );
            } else {
                if (!isNonEmptyString(this.channelProfile.channelSettingsValues.protocol)) {
                    this.messages.push(
                        `The channelProfile.channelSettingsValues.protocol string is ${
                        this.channelProfile.channelSettingsValues.protocol == null ? "missing" : "invalid"
                        }.`
                    );
                }
                if (!isString(this.channelProfile.channelSettingsValues.environment)) {
                    this.messages.push(
                        `The channelProfile.channelSettingsValues.environment string is ${
                        this.channelProfile.channelSettingsValues.environment == null ? "missing" : "invalid"
                        }.`
                    );
                }
                if (!isNonEmptyArray(this.channelProfile.channelSettingsValues.subscriptionLists)) {
                    this.messages.push(
                        `The channelProfile.channelSettingsValues.subscriptionLists array is ${
                        this.channelProfile.channelSettingsValues.subscriptionLists == null ? "missing" : "invalid"
                        }.`
                    );
                } else {
                    if (
                        !this.channelProfile.channelSettingsValues.subscriptionLists.every(
                            list => isNonEmptyObject(list) && isNonEmptyString(list.listId) && isInteger(list.supplierId)
                        )
                    ) {
                        this.messages.push("Every object in the subscriptionLists array must have both a listId and a supplierId.");
                    }
                }
            }

            if (!isObject(this.channelProfile.channelAuthValues)) {
                this.messages.push(
                    `The channelProfile.channelAuthValues object is ${
                    this.channelProfile.channelAuthValues == null ? "missing" : "invalid"
                    }.`
                );
            } else {
                if (!isNonEmptyString(this.channelProfile.channelAuthValues.company_id)) {
                    this.messages.push(
                        `The channelProfile.channelAuthValues.company_id string is ${
                        this.channelProfile.channelAuthValues.company_id == null ? "missing" : "invalid"
                        }.`
                    );
                }
                if (!isNonEmptyString(this.channelProfile.channelAuthValues.location_id)) {
                    this.messages.push(
                        `The channelProfile.channelAuthValues.location_id string is ${
                        this.channelProfile.channelAuthValues.location_id == null ? "missing" : "invalid"
                        }.`
                    );
                }
                if (!isNonEmptyString(this.channelProfile.channelAuthValues.access_token)) {
                    this.messages.push(
                        `The channelProfile.channelAuthValues.access_token string is ${
                        this.channelProfile.channelAuthValues.access_token == null ? "missing" : "invalid"
                        }.`
                    );
                }
            }

            this.referenceLocations.forEach(referenceLocation => {
                if (!isNonEmptyArray(this.channelProfile[referenceLocation])) {
                    this.messages.push(
                        `The channelProfile.${referenceLocation} array is ${
                        this.channelProfile[referenceLocation] == null ? "missing" : "invalid"
                        }.`
                    );
                }
            });
        }
    }

    getBaseUrl(endpointName) {
        return `${this.channelProfile.channelSettingsValues.protocol}://${endpointName}${
            this.channelProfile.channelSettingsValues.environment
            }.iqmetrix.net`;
    }
}

function isFunction(func) {
    return typeof func === "function";
}

function isNonEmptyString(str) {
    return isString(str) && str.trim().length > 0;
}

function isString(str) {
    return typeof str === "string";
}

function isObject(obj) {
    return typeof obj === "object" && obj != null && !isArray(obj) && !isFunction(obj);
}

function isNonEmptyObject(obj) {
    return isObject(obj) && Object.keys(obj).length > 0;
}

function isArray(arr) {
    return Array.isArray(arr);
}

function isNonEmptyArray(arr) {
    return isArray(arr) && arr.length > 0;
}

function isNumber(num) {
    return typeof num === "number" && !isNaN(num);
}

function isInteger(int) {
    return isNumber(int) && int % 1 === 0;
}

function extractBusinessReferences(businessReferences, doc, sep = ".") {
    if (!isArray(businessReferences)) {
        throw new TypeError("Error: businessReferences must be an Array.");
    } else if (!isObject(doc)) {
        throw new TypeError("Error: doc must be an object.");
    } else if (!(isString(sep) || sep == null)) {
        throw new TypeError("Error: sep must be a string (or null).");
    }

    let values = [];

    businessReferences.forEach(businessReference => {
        values.push(jsonata(businessReference).evaluate(doc));
    });

    if (sep == null) {
        return values;
    } else {
        return values.join(sep);
    }
}

module.exports = {
    Stub,
    isFunction,
    isNonEmptyString,
    isString,
    isObject,
    isNonEmptyObject,
    isArray,
    isNonEmptyArray,
    isNumber,
    isInteger,
    extractBusinessReferences
};
