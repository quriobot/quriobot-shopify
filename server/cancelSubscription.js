const { default: Shopify } = require("@shopify/shopify-api");

const cancelSubscription = async (accessToken, shop, charge_id) => {
  const query = `mutation {
    appSubscriptionCancel(
      id: "gid://shopify/AppSubscription/${charge_id}"
    ) {
      userErrors {
        field
        message
      }
      appSubscription {
        id
        status
      }
    }
  }`;

  const client = new Shopify.Clients.Graphql(shop, accessToken);
  const response = await client.query({
    data: query,
  });

  return response.body.data.appSubscriptionCancel.appSubscription.status === 'CANCELLED';
};

module.exports = cancelSubscription;
