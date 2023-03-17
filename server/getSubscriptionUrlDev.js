const { default: Shopify } = require("@shopify/shopify-api");

const getSubscriptionUrlDev = async (accessToken, shop, returnUrl) => {
  const query = `mutation {
    appSubscriptionCreate(
      name: "PREMIUM"
      returnUrl: "${returnUrl}"
      test: true
      trialDays: 7
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              interval: EVERY_30_DAYS
              price: { amount: 4.99, currencyCode: USD }
            }
          }
        }
      ]
    )
    {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
      }
    }
  }`;

  const client = new Shopify.Clients.Graphql(shop, accessToken);
  const response = await client.query({
    data: query,
  });

  return response.body.data.appSubscriptionCreate.confirmationUrl;
};

module.exports = getSubscriptionUrlDev;
