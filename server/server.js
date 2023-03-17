import "@babel/polyfill";
import createShopifyAuth, { verifyRequest } from "@shopify/koa-shopify-auth";
import Shopify from "@shopify/shopify-api";
import dotenv from "dotenv";
import "isomorphic-fetch";
import Koa from "koa";
import Router from "koa-router";
import next from "next";
import Shop from "../models/shop.model";
import User from "../models/user.model";
import {
	deleteCallback,
	loadCallback,
	storeCallback
} from "../utilities/redis-store";

const _ = require("lodash");
const mongoose = require("mongoose");
const bodyParser = require("koa-bodyparser");
const cors = require("@koa/cors");
const fs = require("fs");
const axios = require("axios");
dotenv.config();

mongoose
	.connect(process.env.MONGODB_URL, {
		useCreateIndex: true,
		useNewUrlParser: true,
		useUnifiedTopology: true,
		useFindAndModify: false,
	})
	.then(() => {
		if (process.env.NODE_ENV !== "test") {
			console.log("Connected to %s", "mongodb://127.0.0.1:27017/quriobot");
		}
	});

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

// Storing the currently active shops in memory will force them to re-login when your server restarts. You should
// persist this object in your app.
const ACTIVE_SHOPIFY_SHOPS = {};

if (process.env.NODE_ENV == "development") {
	ACTIVE_SHOPIFY_SHOPS["chienvu-store.myshopify.com"] = "access_token";
}

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
				ACTIVE_SHOPIFY_SHOPS[shop] = scope;

				await Shop.findOneAndUpdate(
					{ shop: shop },
					{
						shop: shop,
						token: accessToken,
					},
					{ upsert: true, new: true, setDefaultsOnInsert: true }
				);

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
		const shopData = await Shop.findOne({ shop });

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
			let shopData = await Shop.findOne({ shop });
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

	// verifyRequest({ accessMode: "offline" }), bodyParser()
	router.post(
		"/api/save_change",
		verifyRequest({ accessMode: "offline" }),
		bodyParser(),
		async (ctx) => {
			let { shop, config } = ctx.request.body;
			let shops = await Shop.findOne({ shop });

			try {
				const ownerId = await getCurrentAppInstallation(shop, shops.token);
				if (ownerId) {
					await axios({
						method: "post",
						url: `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
						headers: {
							"X-Shopify-Access-Token": shops.token,
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
		}
	);

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