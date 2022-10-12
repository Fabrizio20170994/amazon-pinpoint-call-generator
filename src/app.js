const AWS = require("aws-sdk");
const b64 = require("base64-js");
const encryptionSdk = require("@aws-crypto/client-node");
var pinpointsmsvoice = new AWS.PinpointSMSVoice({ apiVersion: "2018-09-05" });
var pinpointSMSText = new AWS.Pinpoint();

const { encrypt, decrypt } = encryptionSdk.buildClient(
	encryptionSdk.CommitmentPolicy.FORBID_ENCRYPT_ALLOW_DECRYPT
);
const generatorKeyId = process.env.KEY_ALIAS;
const keyIds = [process.env.KEY_ARN];
const keyring = new encryptionSdk.KmsKeyringNode({ generatorKeyId, keyIds });
exports.lambda_handler = async (event) => {
	console.log(event);
	let plainTextCode;
	if (event.request.code) {
		const { plaintext, messageHeader } = await decrypt(
			keyring,
			b64.toByteArray(event.request.code)
		);
		plainTextCode = plaintext.toString("ascii");
		console.info(plainTextCode);
	}

	console.info(event.triggerSource);
	if (
		["CustomSMSSender_SignUp", "CustomSMSSender_Authentication"].includes(
			event.triggerSource
		)
	) {
		const phone_number = event.request.userAttributes.phone_number;
		console.info(phone_number);
		if (event.request.clientMetadata.verification_method === "call") {
			let ttsCode = ``;
			for (let c of plainTextCode) {
				ttsCode = ttsCode.concat(`${c} <break time='0.3s' />`);
			}
			console.info(ttsCode);
			const message = `<speak>This is a message from <emphasis>Cognito</emphasis>. <break time='0.5s' /> Your verification code is <break time='0.1s' /> ${ttsCode}. <break time='0.5s' /> I repeat. Your verification code is <break time='0.1s' /> ${ttsCode}.</speak>`;

			return new Promise((resolve) => {
				/*
				 * VoiceID and Language are set from the Polly options:
				 * https://docs.aws.amazon.com/polly/latest/dg/API_Voice.html
				 *
				 * OriginationPhoneNumber Must be the long code set up in Amazon Pinpoint.
				 */
				var parms = {
					Content: {
						SSMLMessage: {
							LanguageCode: process.env.Language,
							Text: message,
							VoiceId: process.env.Voice,
						},
					},
					OriginationPhoneNumber: process.env.LongCode,
					DestinationPhoneNumber: phone_number,
				};

				console.log("Call Parameters: ", JSON.stringify(parms));
				pinpointsmsvoice.sendVoiceMessage(parms, function (err, data) {
					if (err) {
						console.log("Error : " + err.message);
						resolve(phone_number + " " + err.message);
					} else {
						console.log(data);
						resolve(phone_number + " OK");
					}
				});
			});
		}
		// Else it's SMS
		const payloadFn = (appId, destination, message) => {
			const ApplicationId = appId;

			const Addresses = {};
			Addresses[destination] = { ChannelType: "SMS" };

			const MessageConfiguration = {
				SMSMessage: {
					Body: message,
					MessageType: "TRANSACTIONAL",
				},
			};

			return {
				ApplicationId,
				MessageRequest: {
					Addresses,
					MessageConfiguration,
				},
			};
		};
		const appId = process.env.PINPOINT_PROJECT_ID;
		if (event.triggerSource === "CustomSMSSender_Authentication") {
			const message = `Your verification code is ${plainTextCode}`;
		} else {
			const message = `Thanks for signing up for Cognito! Your verification code is ${plainTextCode}`;
		}
		const payload = payloadFn(appId, phone_number, message);
		console.info("Sending SMS");
		await pinpointSMSText.sendMessages(payload).promise();
		console.info("SMS Sent");
		return;
	}
	return;
};
