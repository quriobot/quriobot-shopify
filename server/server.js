import "@babel/polyfill";
import createShopifyAuth, { verifyRequest } from "@shopify/koa-shopify-auth";
import Shopify from "@shopify/shopify-api";
import dotenv from "dotenv";
import "isomorphic-fetch";
import Koa from "koa";
import Router from "koa-router";
import next from "next";
import {
	deleteCallback,
	loadCallback,
	storeCallback
} from "../utilities/redis-store";

const _ = require("lodash");
const bodyParser = require("koa-bodyparser");
const axios = require("axios");

dotenv.config();

const knexConfig = require("../knexfile");

const knex = require('knex')(knexConfig[process.env.NODE_ENV])

const getShopData = async (shop) => {
	const shopData = await knex("shops").first("shop", "token").where({shop});
	return shopData;
}

const path = require("path");
const serve = require("koa-static");
const port = parseInt(process.env.PORT, 10) || 8081;
const dev = process.env.NODE_ENV !== "production";
const app = next({
	dev,
});
const handle = app.getRequestHandler();
const morgan = require("koa-morgan");
const crypto = require("crypto");

Shopify.Context.initialize({
	API_KEY: process.env.SHOPIFY_API_KEY,
	API_SECRET_KEY: process.env.SHOPIFY_API_SECRET,
	SCOPES: process.env.SCOPES
		? process.env.SCOPES.split(",")
		: "read_content,write_content,read_script_tags,write_script_tags,read_products,read_themes",
	HOST_NAME: process.env.HOST.replace(/https:\/\//, ""),
	API_VERSION: "2022-04",
	IS_EMBEDDED_APP: true,
	SESSION_STORAGE: new Shopify.Session.CustomSessionStorage(
		storeCallback,
		loadCallback,
		deleteCallback
	),
});

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2022-01";

app.prepare().then(async () => {
	const server = new Koa();
	const router = new Router();
	server.use(morgan("dev"));
	server.keys = [Shopify.Context.API_SECRET_KEY];
	server.use(
		createShopifyAuth({
			accessMode: "offline",
			async afterAuth(ctx) {
				// Access token and shop available in ctx.state.shopify
				const { shop, accessToken, scope } = ctx.state.shopify;
				const host = ctx.query.host;

				const shopData = await getShopData(shop);

				if (shopData) {
					await knex("shops").where({shop}).update({token: accessToken});
				} else {
					await knex("shops").insert({shop: shop, token: accessToken })
				}

				// Redirect to app with shop parameter upon auth
				ctx.redirect(`/?shop=${shop}&host=${host}`);
			},
		})
	);
	server.use((ctx, next) => {
		const shop = ctx.query.shop;
		if (Shopify.Context.IS_EMBEDDED_APP && shop) {
			ctx.set(
				"Content-Security-Policy",
				`frame-ancestors https://${shop} https://admin.shopify.com;`
			);
		} else {
			ctx.set("Content-Security-Policy", `frame-ancestors 'none';`);
		}
		return next();
	});
	const handleRequest = async (ctx) => {
		await handle(ctx.req, ctx.res);
		ctx.respond = false;
		ctx.res.statusCode = 200;
	};

	const verifyIfActiveShopifyShop = async (ctx, next) => {
		const shop = ctx?.query?.shop || process.env.SHOP;
		const shopData = await getShopData(shop);

		// This shop hasn't been seen yet, go through OAuth to create a session
		if (!shopData) {
			ctx.redirect(`/auth?shop=${shop}`);
			return;
		}

		return next();
	};

	router.get("/", verifyIfActiveShopifyShop, async (ctx) => {
		await handleRequest(ctx);
		return;
	});

	router.post("/webhooks", async (ctx) => {
		try {
			await Shopify.Webhooks.Registry.process(ctx.req, ctx.res);
			console.log(`Webhook processed, returned status code 200`);
		} catch (error) {
			console.log(`Failed to process webhook: ${error}`);
		}
	});

	const verifyWebhook = (ctx) => {
		try {
			let shop = ctx.request.headers["x-shopify-shop-domain"];
			let hmac = ctx.request.headers["x-shopify-hmac-sha256"];
			let hash = crypto
				.createHmac("sha256", process.env.SHOPIFY_API_SECRET)
				.update(ctx.request.rawBody, "utf8", "hex")
				.digest("base64");

			if (hash === hmac) {
				return true;
			}

			return false;
		} catch (error) {
			console.log(error);
			return false;
		}
	};

	router.post("/webhooks/customers/redact", async (ctx) => {
		let verify = verifyWebhook(ctx);
		if (!verify) {
			ctx.status = 401;
			return;
		}

		ctx.status = 200;
	});

	router.post("/webhooks/shop/redact", async (ctx) => {
		let verify = verifyWebhook(ctx);
		if (!verify) {
			ctx.status = 401;
			return;
		}

		ctx.status = 200;
	});

	router.post("/webhooks/customers/data_request", async (ctx) => {
		let verify = verifyWebhook(ctx);
		if (!verify) {
			ctx.status = 401;
			return;
		}

		ctx.status = 200;
	});

	router.post(
		"/graphql",
		verifyRequest({ returnHeader: true }),
		async (ctx, next) => {
			await Shopify.Utils.graphqlProxy(ctx.req, ctx.res);
		}
	);

	async function getCurrentAppInstallation(shop, token) {
		const { data } = await axios({
			method: "post",
			url: `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
			headers: {
				"X-Shopify-Access-Token": token,
			},
			data: {
				query: "query {\n  currentAppInstallation {\n    id\n  }\n}",
				variables: {},
			},
		});
		return data?.data?.currentAppInstallation?.id;
	}

	router.post("/api/get-setting", bodyParser(), async (ctx) => {
		let { shop } = ctx.request.body;
		let shopData = await getShopData(shop);
		const ownerId = await getCurrentAppInstallation(shop, shopData.token);
		try {
			const { data } = await axios({
				method: "post",
				url: `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
				headers: {
					"X-Shopify-Access-Token": shopData.token,
					"Content-Type": "application/json",
				},
				data: {
					query: `query {\n    appInstallation(id: ${JSON.stringify(ownerId)}) {\n        metafield(namespace: "app_settings", key: "general_setting") {\n            value\n        }\n    }\n}`,
					variables: {},
				},
			});

			ctx.status = 200;
			ctx.body = {
				success: true,
				data,
			};
		} catch (error) {
			ctx.status = 200;
			ctx.body = {
				success: false,
			};
		}
	});

	const saveConfig = async (shopData, config) => {
		return axios({
			method: "post",
			url: `https://${shopData.shop}/admin/api/${API_VERSION}/graphql.json`,
			headers: {
				"X-Shopify-Access-Token": shopData.token,
				"Content-Type": "application/json",
			},
			data: {
				query:
					"mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {\n  metafieldsSet(metafields: $metafieldsSetInput) {\n    metafields {\n      id\n      namespace\n      key\n    }\n    userErrors {\n      field\n      message\n    }\n  }\n}",
				variables: {
					metafieldsSetInput: [
						{
							namespace: "app_settings",
							key: "general_setting",
							type: "json",
							value: JSON.stringify(config),
							ownerId: ownerId,
						},
					],
				},
			},
		});
	}

	router.post("/api/reload_embed_code", verifyRequest({ accessMode: "offline" }), bodyParser(), async (ctx) => {
		let { shop } = ctx.request.body;
		try {
			const shopData = await getShopData(shop);
			const ownerId = await getCurrentAppInstallation(shop, shopData.token);
			const { data } = await axios({
				method: "post",
				url: `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
				headers: {
					"X-Shopify-Access-Token": shopData.token,
					"Content-Type": "application/json",
				},
				data: {
					query: `query {\n    appInstallation(id: ${JSON.stringify(ownerId)}) {\n        metafield(namespace: "app_settings", key: "general_setting") {\n            value\n        }\n    }\n}`,
					variables: {},
				},
			});
			let config = data?.data?.appInstallation?.metafield?.value
				? JSON.parse(data?.data?.appInstallation?.metafield?.value)
				: "";
			if (!config) {
				ctx.status = 200;
				ctx.body = {
					success: false,
				};
				return
			}
			let { quriobot_path } = config;
			quriobot_path = quriobot_path.split("\n");
			let embed_codes = await Promise.all(quriobot_path.map(async (path) => {
				let response = await axios.get(`https://api.botsrv2.com/0.0.1/frontend/bots/${path}`, {
					headers: {
						"X-For-Embed-Code": true
					}
				});
				return response.data.frontend.embed_code_2;
			}));
			config = {
				...config,
				embed_codes
			}
			await saveConfig(shopData, config);
			ctx.status = 200;
			ctx.body = {
				success: true,
			};
		} catch (error) {
			ctx.status = 200;
			ctx.body = {
				success: false,
			};
		}
	});

	router.post("/api/save_change", verifyRequest({ accessMode: "offline" }), bodyParser(), async (ctx) => {
		let { shop, config } = ctx.request.body;
		let shopData = await getShopData(shop);

		try {
			const ownerId = await getCurrentAppInstallation(shop, shopData.token);
			if (ownerId) {
				let { quriobot_path } = config;
				quriobot_path = quriobot_path.split("\n");
				let embed_codes = await Promise.all(quriobot_path.map(async (path) => {
					let response = await axios.get(`https://${process.env.QURIBOT_FRONTEND_API}/${path}`, {
						headers: {
							"X-For-Embed-Code": true
						}
					});
					return response.data.frontend.embed_code_2;
				}));
				config = {
					...config,
					embed_codes
				}
				await saveConfig(shopData, config);
				ctx.status = 200;
				ctx.body = {
					success: true,
				};
			}
		} catch (error) {
			ctx.status = 400;
			ctx.body = {
				success: false,
				error: error,
			};
		}
	});

	router.get("(/_next/static/.*)", handleRequest); // Static content is clear
	router.get("/_next/webpack-hmr", handleRequest); // Webpack content is clear
	router.get("(.*)", verifyIfActiveShopifyShop, handleRequest);

	const staticDirPath = path.join(process.cwd(), "public");
	server.use(serve(staticDirPath));
	server.use(router.allowedMethods());
	server.use(router.routes());
	server.listen(port, () => {
		console.log(`> Ready on http://localhost:${port}`);
	});
});