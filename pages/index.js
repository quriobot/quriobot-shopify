import { useAppBridge } from "@shopify/app-bridge-react";
import { getSessionToken } from "@shopify/app-bridge-utils";
import {
	Card,
	FormLayout,
	Frame,
	Layout,
	Page,
	TextField,
	Toast,
} from "@shopify/polaris";
import axios from "axios";
import { useFormik } from "formik";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import * as Yup from "yup";

React.useLayoutEffect = React.useEffect 

const Index = () => {
	const app = useAppBridge();
	const router = useRouter();

	const [isLoading, setIsLoading] = useState(false);
	const [isActiveSuccess, setIsActiveSuccess] = useState(false);
	const shop = router?.query?.shop || "";

	const validationSchema = Yup.object().shape({
		quriobot_path: Yup.string().required("This field is required!")
	});

	const formik = useFormik({
		initialValues: {
			quriobot_path: "",
			quriobot_init: "",
		},
		onSubmit: (values) => {
			handleSubmit(values);
		},
		validationSchema,
	});

	const handleSubmit = async () => {
		let sessionToken = await getSessionToken(app);
		setIsLoading(true);
		let body = {
			shop,
			config: {
				quriobot_path: formik.values.quriobot_path,
				quriobot_init: formik.values.quriobot_init,
			},
		};
		try {
			let data = await axios.post("/api/save_change", body, {
				headers: {
					Authorization: `Bearer ${sessionToken}`,
				},
			});
			if (data) setIsActiveSuccess(true);
			setIsLoading(false);
		} catch (error) {
			setIsLoading(false);
		}
	};

	const handleReloadCode = async () => {
		let sessionToken = await getSessionToken(app);
		setIsLoading(true);
		let body = {
			shop
		}
		try {
			let data = await axios.post("/api/reload_embed_code", body, {
				headers: {
					Authorization: `Bearer ${sessionToken}`,
				},
			});
			if (data) setIsActiveSuccess(true);
			setIsLoading(false);
		} catch (error) {
			setIsLoading(false);
		}
	}

	const getSetting = async () => {
		let sessionToken = await getSessionToken(app);
		try {
			let { data } = await axios.post(
				"/api/get-setting",
				{ shop },
				{
					headers: {
						Authorization: `Bearer ${sessionToken}`,
					},
				}
			);
			const valueSetting = data?.data?.data?.appInstallation?.metafield?.value
				? JSON.parse(data?.data?.data?.appInstallation?.metafield?.value)
				: "";
				
			if (valueSetting) {
				formik.setValues({
					quriobot_path: valueSetting.quriobot_path,
					quriobot_init: valueSetting.quriobot_init,
				});
			}
		} catch (error) {}
	};

	const onChange = (value, id) => {
		formik.handleChange({ target: { id, value } });
	};

	const messageSuccess = () => {
		setTimeout(() => {
			setIsActiveSuccess(false);
		}, 2000);

		return isActiveSuccess && <Toast duration={2} content={"Saved!"} />;
	};

	useEffect(() => {
		if (shop) {
			getSetting();
		}
	}, [shop]);

	return (
		<Frame>
			<Page
				title="Settings"
				primaryAction={{
					content: "Save changes",
					onAction: handleSubmit,
					loading: isLoading,
				}}
				secondaryActions={[
					{
						content: "Reload embed code",
						onAction: handleReloadCode,
						loading: isLoading
					}
				]}
			>
				<Layout>
					<Layout.Section>
						<Card sectioned>
							<FormLayout>
									<TextField
										id="quriobot_path"
										name="quriobot_path"
										error={formik.errors.quriobot_path}
										value={formik.values.quriobot_path}
										onChange={onChange}
										label="Bot paths"
										multiline
										helpText="(Leave blank to disable). If you want to put multiple bots on your website, add each bot path on the separate line"
									></TextField>
									<TextField
										id="quriobot_init"
										name="quriobot_init"
										value={formik.values.quriobot_init}
										onChange={onChange}
										label="Customize bot initialization"
										placeholder="window.qbOptions.push({use: 'asdfasdfasfasd/adfadfasdfasd',lang: document.getElementsByTagName('html')[0].getAttribute('lang').toLowerCase()})"
										multiline
										helpText="(Leave blank to disable). If you need to fully customize the options provided for the widget initalization, provide the code which will be put into <script> tag before the widget <script> tag"
									></TextField>
							</FormLayout>
						</Card>
					</Layout.Section>
				</Layout>
			</Page>
			{messageSuccess()}
		</Frame>
	);
};

export default Index;
