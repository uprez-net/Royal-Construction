// The AI Gateway image model behind the offer's proposal photos (issue #346).
//
// It was google/imagen-4.0-fast-generate-001 until Google retired Imagen 4 and
// the gateway dropped it; every generation then failed with "Model ... not
// found" and the provider's own text went straight onto the offer screen.
// Gemini 3.1 Flash Image takes the 16:9 and 4:3 aspect ratios the proposal
// slots ask for. The gateway lists it as a LANGUAGE model, so it is called with
// generateText and its image read from the response files — gateway.image()
// refuses it. Check https://ai-gateway.vercel.sh/v1/models before changing it,
// and switch the call back to generateImage for a model of type "image".
export const OFFER_IMAGE_MODEL_ID = "google/gemini-3.1-flash-image";

// What the estimator reads when the provider fails. The provider's message
// (model ids, quota text, request ids) is for the server log, not the offer
// screen: they can act on "try again or upload one", not on a model id.
export const OFFER_IMAGE_GENERATION_FAILED =
  "The image couldn't be generated just now. Try again, or upload a photo for this slot instead.";
