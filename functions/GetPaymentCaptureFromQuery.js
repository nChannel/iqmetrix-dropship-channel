'use strict'
const nc = require("./util/ncUtils");

let GetPaymentCaptureFromQuery = function (ncUtil, channelProfile, flowContext, payload, callback) {

  log("Building response object...", ncUtil);
  let out = {
    ncStatusCode: null,
    response: {},
    payload: {}
  };

  let invalid = false;
  let invalidMsg = "";

  //If ncUtil does not contain a request object, the request can't be sent
  if (!ncUtil) {
    invalid = true;
    invalidMsg = "ncUtil was not provided"
  }

  //If channelProfile does not contain channelSettingsValues, channelAuthValues or paymentCaptureBusinessReferences, the request can't be sent
  if (!channelProfile) {
    invalid = true;
    invalidMsg = "channelProfile was not provided"
  } else if (!channelProfile.channelSettingsValues) {
    invalid = true;
    invalidMsg = "channelProfile.channelSettingsValues was not provided"
  } else if (!channelProfile.channelSettingsValues.protocol) {
    invalid = true;
    invalidMsg = "channelProfile.channelSettingsValues.protocol was not provided"
  } else if (!channelProfile.channelSettingsValues.environment) {
    invalid = true;
    invalidMsg = "channelProfile.channelSettingsValues.environment was not provided"
  } else if (!channelProfile.channelAuthValues) {
    invalid = true;
    invalidMsg = "channelProfile.channelAuthValues was not provided"
  } else if (!channelProfile.channelAuthValues.access_token) {
    invalid = true;
    invalidMsg = "channelProfile.channelAuthValues.access_token was not provided"
  } else if (!channelProfile.channelAuthValues.company_id) {
    invalid = true;
    invalidMsg = "channelProfile.channelAuthValues.company_id was not provided"
  } else if (!channelProfile.paymentCaptureBusinessReferences) {
    invalid = true;
    invalidMsg = "channelProfile.paymentCaptureBusinessReferences was not provided"
  } else if (!Array.isArray(channelProfile.paymentCaptureBusinessReferences)) {
    invalid = true;
    invalidMsg = "channelProfile.paymentCaptureBusinessReferences is not an array"
  } else if (channelProfile.paymentCaptureBusinessReferences.length === 0) {
    invalid = true;
    invalidMsg = "channelProfile.paymentCaptureBusinessReferences is empty"
  } else if (!channelProfile.salesOrderBusinessReferences) {
    invalid = true;
    invalidMsg = "channelProfile.salesOrderBusinessReferences was not provided"
  } else if (!Array.isArray(channelProfile.salesOrderBusinessReferences)) {
    invalid = true;
    invalidMsg = "channelProfile.salesOrderBusinessReferences is not an array"
  } else if (channelProfile.salesOrderBusinessReferences.length === 0) {
    invalid = true;
    invalidMsg = "channelProfile.salesOrderBusinessReferences is empty"
  }

  //If a paymentCapture document was not passed in, the request is invalid
  if (!payload) {
    invalid = true;
    invalidMsg = "payload was not provided"
  } else if (!payload.doc) {
    invalid = true;
    invalidMsg = "payload.doc was not provided";
  } else if (!payload.doc.remoteIDs && !payload.doc.searchFields && !payload.doc.modifiedDateRange) {
    invalid = true;
    invalidMsg = "either payload.doc.remoteIDs or payload.doc.searchFields or payload.doc.modifiedDateRange must be provided"
  } else if (payload.doc.remoteIDs && (payload.doc.searchFields || payload.doc.modifiedDateRange)) {
    invalid = true;
    invalidMsg = "only one of payload.doc.remoteIDs or payload.doc.searchFields or payload.doc.modifiedDateRange may be provided"
  } else if (payload.doc.remoteIDs && (!Array.isArray(payload.doc.remoteIDs) || payload.doc.remoteIDs.length === 0)) {
    invalid = true;
    invalidMsg = "payload.doc.remoteIDs must be an Array with at least 1 remoteID"
  } else if (payload.doc.searchFields && (!Array.isArray(payload.doc.searchFields) || payload.doc.searchFields.length === 0)) {
    invalid = true;
    invalidMsg = "payload.doc.searchFields must be an Array with at least 1 key value pair: {searchField: 'key', searchValues: ['value_1']}"
  } else if (payload.doc.searchFields) {
    for (let i = 0; i < payload.doc.searchFields.length; i++) {
      if (!payload.doc.searchFields[i].searchField || !Array.isArray(payload.doc.searchFields[i].searchValues) || payload.doc.searchFields[i].searchValues.length === 0) {
        invalid = true;
        invalidMsg = "payload.doc.searchFields[" + i + "] must be a key value pair: {searchField: 'key', searchValues: ['value_1']}";
        break;
      }
    }
  } else if (payload.doc.modifiedDateRange && !(payload.doc.modifiedDateRange.startDateGMT || payload.doc.modifiedDateRange.endDateGMT)) {
    invalid = true;
    invalidMsg = "at least one of payload.doc.modifiedDateRange.startDateGMT or payload.doc.modifiedDateRange.endDateGMT must be provided"
  } else if (payload.doc.modifiedDateRange && payload.doc.modifiedDateRange.startDateGMT && payload.doc.modifiedDateRange.endDateGMT && (payload.doc.modifiedDateRange.startDateGMT > payload.doc.modifiedDateRange.endDateGMT)) {
    invalid = true;
    invalidMsg = "startDateGMT must have a date before endDateGMT";
  }

  //If callback is not a function
  if (!callback) {
    throw new Error("A callback function was not provided");
  } else if (typeof callback !== 'function') {
    throw new TypeError("callback is not a function")
  }

  if (!invalid) {
    let request = require('request');

    let url = `${channelProfile.channelSettingsValues.protocol}://ordermanagementreporting${channelProfile.channelSettingsValues.environment}.iqmetrix.net`

    /*
     Create query string for searching orders by specific fields
     */
    let queryParams = [];
    let filterParams = [];
    let uris = [];

    if (payload.doc.remoteIDs) {
      /*
       Add remote IDs as a query parameter
       */
      payload.doc.remoteIDs.forEach((remoteID) => {
        let endpoint = "/Reports/OrderList/report?filter=companyId eq " + channelProfile.channelAuthValues.company_id + " and id eq " + remoteID;
        uris.push(endpoint);
      });

    } else if (payload.doc.modifiedDateRange) {
      /*
       Add modified date ranges to the query
       iQmetrix only supports exclusive compare operator so skew each by 1 ms to create an equivalent inclusive range
       */
      if (payload.doc.modifiedDateRange.startDateGMT) {
        filterParams.push("updatedUtc gt " + new Date(Date.parse(payload.doc.modifiedDateRange.startDateGMT) - 1).toISOString());
      }
      if (payload.doc.modifiedDateRange.endDateGMT) {
        filterParams.push("updatedUtc lt " + new Date(Date.parse(payload.doc.modifiedDateRange.endDateGMT) + 1).toISOString());
      }

      let endpoint = "/Reports/OrderList/report?filter=companyId eq " + channelProfile.channelAuthValues.company_id + " and " + filterParams.join(' and ');
      uris.push(endpoint);
    }

    /*
     Add page to the query
     */
    if (payload.doc.page) {
      queryParams.push("&page=" + payload.doc.page);
    }

    /*
     Add pageSize to the query
     */
    if (payload.doc.pageSize) {
      queryParams.push("&pageSize=" + payload.doc.pageSize);
    }

    uris.forEach(function(uri) {
      // Add the authorization header
      let headers = {
        "Authorization": "Bearer " + channelProfile.channelAuthValues.access_token
      };

      /*
       Set URL and headers
       */
      let options = {
        url: url + uri + queryParams.join(''),
        headers: headers,
        json: true
      };

      log("Using URL [" + url + uri + queryParams.join('') + "]", ncUtil);

      // Pass in our URL and headers
      request(options, async function (error, response, body) {
        try {
          if (!error) {
            console.log(body);
            log("Do GetPaymentCaptureFromQuery Callback", ncUtil);
            out.response.endpointStatusCode = response.statusCode;
            out.response.endpointStatusMessage = response.statusMessage;

            if (response.statusCode === 200 && body.rows.length > 0) {
              if (body.rows.length < body.totalRecords) {
                out.ncStatusCode = 206;
              } else {
                out.ncStatusCode = 200;
              }

              //For each order, get the order detail (i.e. paymentCapture)
              let paymentCapturePromises = body.rows.map((order) => {
                let paymentCapture = {
                  response: {}
                };

                let endPoint = "/Companies(" + channelProfile.channelAuthValues.company_id + ")/OrderDetails(" + order._id + ")";
                let url = `${channelProfile.channelSettingsValues.protocol}://ordermanagementreporting${channelProfile.channelSettingsValues.environment}.iqmetrix.net${endPoint}`;
                options.url = url;

                log("Using URL [" + url + "]", ncUtil);

                return new Promise((resolve, reject) => {
                  try {
                    request(options, function (error, response, body) {
                      if (!error) {
                        paymentCapture.response.endpointStatusCode = response.statusCode;
                        paymentCapture.response.endpointStatusMessage = response.statusMessage;

                        if (response.statusCode === 200) {
                          paymentCapture.ncStatusCode = 200;
                          paymentCapture.doc = body;
                          paymentCapture.paymentCaptureRemoteID = body.id;
                          paymentCapture.paymentCaptureBusinessReference = nc.extractBusinessReferences(channelProfile.paymentCaptureBusinessReferences, body);
                          paymentCapture.salesOrderRemoteID = body.dropshipOrderItems[0].dropshipOrderId;
                          paymentCapture.salesOrderBusinessReference = nc.extractBusinessReferences(channelProfile.salesOrderBusinessReferences, body);

                        } else if (response.statusCode === 429) {
                          paymentCapture.ncStatusCode = 429;
                          paymentCapture.error = body;
                        } else if (response.statusCode === 500) {
                          paymentCapture.ncStatusCode = 500;
                          paymentCapture.error = body;
                        } else {
                          paymentCapture.ncStatusCode = 400;
                          paymentCapture.error = body;
                        }
                      } else {
                        logError("Do GetPaymentCaptureFromQuery Callback error - " + error, ncUtil);
                        paymentCapture.error = error;
                        paymentCapture.ncStatusCode = 500;
                      }

                      resolve(paymentCapture);
                    });
                  } catch (err) {
                    let rej = {payload: {}};
                    rej.ncStatusCode = 500;
                    rej.payload.error = {err: err, stack: err.stackTrace};
                    reject(rej);
                  }
                });
              });

              try {
                out.payload = await Promise.all(paymentCapturePromises);
              } catch (rejected) {
                out.ncStatusCode = rejected.ncStatusCode;
                out.payload = rejected.payload;
              }

            } else if (response.statusCode === 200) {
              out.ncStatusCode = 204;
            } else if (response.statusCode === 429) {
              out.ncStatusCode = 429;
              out.payload.error = body;
            } else if (response.statusCode === 500) {
              out.ncStatusCode = 500;
              out.payload.error = body;
            } else {
              out.ncStatusCode = 400;
              out.payload.error = body;
            }

            callback(out);
          } else {
            logError("Do GetPaymentCaptureFromQuery Callback error - " + error, ncUtil);
            out.payload.error = error;
            out.ncStatusCode = 500;
            callback(out);
          }
        } catch (err) {
          logError("Exception occurred in GetPaymentCaptureFromQuery - " + err, ncUtil);
          out.payload.error = {err: err, stack: err.stackTrace};
          out.ncStatusCode = 500;
          callback(out);
        }
      });
    });
  } else {
    log("Callback with an invalid request - " + invalidMsg, ncUtil);
    out.ncStatusCode = 400;
    out.payload.error = invalidMsg;
    callback(out);
  }
};

function logError(msg, ncUtil) {
  console.log("[error] " + msg);
}

function log(msg, ncUtil) {
  console.log("[info] " + msg);
}

module.exports.GetPaymentCaptureFromQuery = GetPaymentCaptureFromQuery;
