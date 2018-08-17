const getProductSimple = require("./GetProductSimpleFromQuery").GetProductSimpleFromQuery;
const getProductMatrix = require("./GetProductMatrixFromQuery").GetProductMatrixFromQuery;

const ncUtil = {
  request: {},
  logger: null
}

const channelProfile = {
  productBusinessReferences: ["Slug"],
  channelAuthValues: {
    company_id: "149937",
    location_id: "184763",
    access_token: "YkJ1dd2zb3ViSHR1YvM8d2JCMxkaMztHNCA0PS11ORsAFQEZVwowHSA0LAErGBotFHYNTQoXHBkFDSFGOgxFMFQ4HC1UFQERDTsg"
  },
  channelSettingsValues: {
    protocol: "https",
    environment: "rc",
    subscriptionLists: [
      {
        listId: "3972ead4-6e1e-4df1-be8b-c02b6cd20c7f",
        supplierId: 7187
      },
      {
        listId: "8b426f39-5ba9-48d1-960c-22c425344a74",
        supplierId: 188979
      }
    ],
    canPostInvoice: "SaleInvoice"
  }
};

const flowContext = null;

const payload = {
  doc: {
    remoteIDs: [
      "74b6fb4d-e741-4413-98ac-1375311b54fb",
      "22411435-d53b-40ad-b90b-99506ca88df4",
      "19e5afb2-cabf-48e6-9337-8af8defc784e"
    ],
    page: 1,
    pageSize: 25
  }
}


// getProductSimple(ncUtil, channelProfile, flowContext, payload, (resp) => {
//   console.log("ggggggggggggggggggggggggggggggggggggggggg");
//   console.log(JSON.stringify(resp));
//   console.log("ggggggggggggggggggggggggggggggggggggggggg");
// });

getProductMatrix(ncUtil, channelProfile, flowContext, payload, resp => {
  console.log("ggggggggggggggggggggggggggggggggggggggggg");
  console.log(JSON.stringify(resp));
  console.log("ggggggggggggggggggggggggggggggggggggggggg");
});
