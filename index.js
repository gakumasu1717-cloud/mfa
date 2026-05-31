// MFA - Message Format Adapter
// Processes SillyTavern custom endpoint requests while preserving the selected custom URL and API headers.
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "mfa";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const settingsPathCandidates = [
    `${extensionFolderPath}/settings.html`,
    "scripts/extensions/third-party/mfa-main/settings.html",
    "scripts/extensions/third-party/MFA/settings.html",
];

const defaultSettings = {
    enabled: true,
    removePrefill: true,
    trimAssistant: true,
    forceLastUser: true,
    basicAuthCompat: false,
    debugLog: true,
    endpoint: "anthropic",  // Body mode: "openai", "anthropic", "anthropic-thinking", "passthrough", "responses"
    thinkingBudget: 10000,
    adaptiveThinking: false,

};

const LOG_MAX = 200;

// ============================================================
// ?붾쾭洹?濡쒓렇
// ============================================================
const DebugLog = {
    entries: [],

    _renderTimer: null,

    add(level, ...args) {
        const s = getSettings();

        // ?붾쾭洹?爰쇱졇?덉쑝硫?ERROR/WARN留?肄섏넄??異쒕젰?섍퀬 ??        if (!s.debugLog) {
            if (level === "ERROR") console.error(`[MFA] ${args.join(" ")}`);
            else if (level === "WARN") console.warn(`[MFA] ${args.join(" ")}`);
            return;
        }

        const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
        const msg = args.map(a =>
            typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)
        ).join(" ");

        this.entries.push({ time, level, msg });
        if (this.entries.length > LOG_MAX) this.entries.shift();

        if (level === "ERROR") console.error(`[MFA] ${msg}`);
        else if (level === "WARN") console.warn(`[MFA] ${msg}`);
        else console.log(`[MFA] ${msg}`);

        // ?붾컮?댁뒪 ?뚮뜑留?(200ms ??以묐났 ?몄텧 諛⑹?)
        if (!this._renderTimer) {
            this._renderTimer = setTimeout(() => {
                this._renderTimer = null;
                this.render();
            }, 200);
        }
    },

    info(...a) { this.add("INFO", ...a); },
    warn(...a) { this.add("WARN", ...a); },
    error(...a) { this.add("ERROR", ...a); },


    request(method, url, headers, body) {
        this.add("REQ", `?곣봺???붿껌 ?곣봺??);
        this.add("REQ", `${method} ${url}`);
        this.add("REQ", `紐⑤뜽: ${body?.model || "?"} | stream: ${body?.stream} | temp: ${body?.temperature ?? "?"} | max_tokens: ${body?.max_tokens ?? "?"}`);

        const safe = { ...headers };
        if (safe["Authorization"]) safe["Authorization"] = safe["Authorization"].substring(0, 20) + "...";
        this.add("REQ", `?ㅻ뜑: ${JSON.stringify(safe)}`);

        // messages 媛쒕퀎 異쒕젰
        const msgs = body?.messages || [];
        if (msgs.length > 0) {
            this.add("REQ", `?곣봺??Messages (${msgs.length}媛? ?곣봺??);
            msgs.forEach((m, i) => {
                const c = typeof m.content === "string" ? m.content
                    : Array.isArray(m.content) ? m.content.map(b => b.text || "").join("") 
                    : JSON.stringify(m.content);
                this.add("REQ", `[${i}] role=${m.role} (${c.length}??\n${c}`);
            });
            this.add("REQ", `?곣봺??Messages ???곣봺??);
        }

        // system (Anthropic ?щ㎎)
        if (body?.system) {
            const sysText = Array.isArray(body.system) ? body.system.map(s => s.text || "").join("") : String(body.system);
            this.add("REQ", `?곣봺??System (${sysText.length}?? ?곣봺??n${sysText}`);
        }

        // instructions / input (Responses ?щ㎎)
        if (body?.instructions) {
            const instructionsText = typeof body.instructions === "string" ? body.instructions : JSON.stringify(body.instructions);
            this.add("REQ", `?곣봺??Instructions (${instructionsText.length}?? ?곣봺??n${instructionsText}`);
        }

        const inputItems = Array.isArray(body?.input) ? body.input : [];
        if (inputItems.length > 0) {
            this.add("REQ", `?곣봺??Input (${inputItems.length}媛? ?곣봺??);
            inputItems.forEach((item, i) => {
                const c = extractTextFromMessageContent(item?.content, `request.input[${i}]`);
                this.add("REQ", `[${i}] role=${item?.role || "?"} (${c.length}??\n${c}`);
            });
            this.add("REQ", `?곣봺??Input ???곣봺??);
        }
        const params = { ...body };
        delete params.messages;
        delete params.system;
        delete params.instructions;
        delete params.input;
        this.add("REQ", `湲고?: ${JSON.stringify(params)}`);
    },

    response(status, statusText, bodyPreview) {
        this.add("RES", `?곣봺???묐떟 ?곣봺??);
        this.add("RES", `?곹깭: ${status} ${statusText || ""}`);
        if (bodyPreview) {
            this.add("RES", `?댁슜: ${bodyPreview.substring(0, 300)}${bodyPreview.length > 300 ? "..." : ""}`);
        }
    },

    _lastRenderedCount: 0,

    _buildEntry(e, idx) {
        const colors = { INFO: "#8bc34a", WARN: "#FF9800", ERROR: "#f44336", REQ: "#64b5f6", RES: "#ce93d8" };
        const FOLD_THRESHOLD = 200;
        const c = colors[e.level] || "#ccc";
        const escaped = escapeHtmlBr(e.msg);
        const header = `<span style="color:#666;">[${e.time}]</span> <span style="color:${c};font-weight:bold;">[${e.level}]</span> `;
        if (e.msg.length > FOLD_THRESHOLD) {
            const preview = escapeHtmlBr(e.msg.substring(0, FOLD_THRESHOLD));
            return `<div style="margin:1px 0;">${header}<span class="cpi-fold" data-idx="${idx}"><span class="cpi-fold-short" style="color:#ddd;">${preview}<span class="cpi-fold-btn" data-action="expand" style="color:#64b5f6;cursor:pointer;margin-left:4px;">???쇱튂湲?/span></span><span class="cpi-fold-long" style="display:none;color:#ddd;">${escaped}<br><span class="cpi-fold-btn" data-action="collapse" style="color:#64b5f6;cursor:pointer;">???묎린</span></span></span></div>`;
        }
        return `<div style="margin:1px 0;">${header}<span style="color:#ddd;">${escaped}</span></div>`;
    },

    render() {
        const el = $("#cpi_log_content");
        if (!el.length) return;

        // LOG_MAX?쇰줈 shift ?먭굅??clear ?먯쑝硫??꾩껜 ?ㅼ떆 洹몃┝
        if (this.entries.length < this._lastRenderedCount) {
            el.html(this.entries.map((e, i) => this._buildEntry(e, i)).join(""));
            this._lastRenderedCount = this.entries.length;
        } else if (this.entries.length > this._lastRenderedCount) {
            // ?덈줈 異붽???寃껊쭔 append
            const newHtml = this.entries
                .slice(this._lastRenderedCount)
                .map((e, i) => this._buildEntry(e, this._lastRenderedCount + i))
                .join("");
            el[0].insertAdjacentHTML("beforeend", newHtml);
            this._lastRenderedCount = this.entries.length;
        }

        requestAnimationFrame(() => {
            el.scrollTop(el[0]?.scrollHeight || 0);
        });
    },

    clear() { this.entries = []; this._lastRenderedCount = 0; $("#cpi_log_content").html(""); },
};

function escapeHtmlBr(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

// ============================================================
// ?좏떥
// ============================================================
function hasAnyToken() {
    return true;
}

function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = JSON.parse(JSON.stringify(defaultSettings));
    }
    return extension_settings[extensionName];
}

function saveSettings() { saveSettingsDebounced(); }

async function loadSettingsHtml() {
    let lastError = null;
    for (const path of settingsPathCandidates) {
        try {
            return await $.get(path);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("settings.html not found");
}

function getCustomUrl(requestBody) {
    const url = String(requestBody?.custom_url || "").trim();
    if (!url) throw new Error("Custom endpoint URL is empty");
    return url;
}

function buildCustomHeaders(requestBody, accept = "application/json") {
    const headers = {
        "Content-Type": "application/json",
        "Accept": accept,
    };

    const customHeaders = requestBody?.custom_include_headers;
    if (customHeaders && typeof customHeaders === "object" && !Array.isArray(customHeaders)) {
        Object.assign(headers, customHeaders);
    }

    const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
    const apiKey = requestBody?.api_key_custom || requestBody?.api_key || requestBody?.reverse_proxy_password || requestBody?.proxy_password;
    if (!hasAuth && typeof apiKey === "string" && apiKey.trim()) {
        headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    return headers;
}

// ============================================================
// OpenAI ??Anthropic ?щ㎎ 蹂??// ============================================================
function convertToAnthropicFormat(messages, model, params) {
    const openAIChats = structuredClone(messages);

    // 1) 泥?assistant ?깆옣 ?꾧퉴吏??硫붿떆吏瑜?system ?뚮씪誘명꽣濡?異붿텧
    let splitIndex = openAIChats.findIndex(m => m.role === "assistant");
    if (splitIndex === -1) {
        splitIndex = Math.max(0, openAIChats.length - 1);
    }

    let systemText = "";
    for (let i = 0; i < splitIndex; i++) {
        const content = typeof openAIChats[i].content === "string"
            ? openAIChats[i].content.trim() : "";
        if (!content) continue;
        if (systemText) systemText += "\n\n";
        systemText += content;
    }
    openAIChats.splice(0, splitIndex);

    // 2) 泥?硫붿떆吏媛 user媛 ?꾨땲硫??붾? 異붽?
    if (openAIChats.length === 0 || openAIChats[0].role !== "user") {
        openAIChats.unshift({ role: "user", content: "Start" });
    }

    // 3) messages 蹂??(媛숈? role ?곗냽 蹂묓빀 + system?뭫ser 蹂??
    const anthropicMessages = [];
    for (const msg of openAIChats) {
        let content = "";
        if (typeof msg.content === "string") {
            content = msg.content.trim();
        } else if (Array.isArray(msg.content)) {
            content = msg.content.map(b => b.text || "").join("").trim();
        }
        if (!content) continue;  // 鍮?硫붿떆吏 ?ㅽ궢
        const last = anthropicMessages.length > 0 ? anthropicMessages[anthropicMessages.length - 1] : null;

        if (msg.role === "system") {
            const text = "system: " + content;
            if (last?.role === "user") {
                last.content[0].text += "\n\n" + text;
            } else {
                anthropicMessages.push({ role: "user", content: [{ type: "text", text }] });
            }
        } else if (msg.role === "user" || msg.role === "assistant") {
            if (last?.role === msg.role) {
                last.content[0].text += "\n\n" + content;
            } else {
                anthropicMessages.push({ role: msg.role, content: [{ type: "text", text: content }] });
            }
        }
    }

    // 4) messages媛 鍮꾩뼱?덉쑝硫??붾?
    if (anthropicMessages.length === 0) {
        anthropicMessages.push({ role: "user", content: [{ type: "text", text: "Start" }] });
    }

    // 5) 留덉?留됱씠 user?몄? ?뺤씤
    if (anthropicMessages[anthropicMessages.length - 1].role !== "user") {
        anthropicMessages.push({ role: "user", content: [{ type: "text", text: "Continue" }] });
    }

    // 6) user?봞ssistant 援먮? 寃利????곗냽 媛숈? role ?덉쑝硫?蹂묓빀
    const validated = [];
    for (const msg of anthropicMessages) {
        const text = msg.content[0]?.text?.trim();
        if (!text) continue;  // 鍮?text 理쒖쥌 ?쒓굅
        msg.content[0].text = text;
        const last = validated.length > 0 ? validated[validated.length - 1] : null;
        if (last && last.role === msg.role) {
            last.content[0].text += "\n\n" + text;
        } else {
            validated.push(msg);
        }
    }

    // 寃利???鍮꾩뼱?덉쑝硫??붾?
    if (validated.length === 0) {
        validated.push({ role: "user", content: [{ type: "text", text: "Start" }] });
    }
    if (validated[validated.length - 1].role !== "user") {
        validated.push({ role: "user", content: [{ type: "text", text: "Continue" }] });
    }

    // 7) body 援ъ꽦
    const body = {
        model: model,
        messages: validated,
        max_tokens: params.max_tokens || 8192,
    };

    if (systemText) {
        body.system = [{ type: "text", text: systemText }];
    }

    // thinking 紐⑤뱶
    if (params.thinking) {
        if (params.adaptiveThinking) {
            body.thinking = { type: "adaptive" };
            DebugLog.info("Adaptive Thinking ?쒖꽦??);
        } else {
            const budget = params.thinkingBudget || 10000;
            body.thinking = { type: "enabled", budget_tokens: budget };
            if (body.max_tokens <= budget) {
                body.max_tokens = budget + 4096;
            }
        }
        // thinking ?ъ슜 ??temperature ?ㅼ젙 遺덇? (Anthropic ?쒗븳)
    } else {
        // temperature ?대옩??(Anthropic: 0.0~1.0)
        if (params.temperature != null) {
            body.temperature = Math.min(Math.max(params.temperature, 0), 1.0);
        }
        // top_p: temperature ?놁쓣 ?뚮쭔
        if (params.temperature == null && params.top_p != null) {
            body.top_p = Math.min(Math.max(params.top_p, 0), 1.0);
        }
    }
    if (params.stream != null) body.stream = params.stream;

    return body;
}

// ============================================================
// Responses ?대뙌???좏떥
// ST(OpenAI-style) ?붿껌/?묐떟??Responses ?щ㎎?쇰줈 蹂??// ============================================================
function buildTargetUrl(requestBody) {
    return getCustomUrl(requestBody);
}

function previewText(text, max = 160) {
    if (!text) return "";
    const compact = String(text).replace(/\s+/g, " ").trim();
    return compact.length > max ? `${compact.substring(0, max)}...` : compact;
}

function extractTextFromMessageContent(content, context = "message") {
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
        let text = "";
        content.forEach((part, index) => {
            if (typeof part === "string") {
                text += part;
                return;
            }
            if (!part || typeof part !== "object") {
                DebugLog.warn(`${context}[${index}] ?????녿뒗 content part`);
                return;
            }
            if (typeof part.text === "string") {
                text += part.text;
                return;
            }
            if (typeof part.content === "string") {
                text += part.content;
                return;
            }
            DebugLog.warn(`${context}[${index}] 誘몄???part type: ${part.type || "unknown"}`);
        });
        return text;
    }

    if (content && typeof content === "object") {
        if (typeof content.text === "string") return content.text;
        if (typeof content.content === "string") return content.content;
        DebugLog.warn(`${context} ?????녿뒗 object content`);
    }

    return "";
}

function buildResponsesReasoningConfig(requestBody) {
    const existing = requestBody?.reasoning && typeof requestBody.reasoning === "object"
        ? requestBody.reasoning
        : {};
    const reasoning = {};

    const effort = existing.effort ?? requestBody?.reasoning_effort;
    if (effort != null) {
        reasoning.effort = effort;
    }

    const summary = existing.summary ?? (requestBody?.include_reasoning ? "auto" : undefined);
    if (summary != null && summary !== false) {
        reasoning.summary = summary;
    }

    return Object.keys(reasoning).length > 0 ? reasoning : null;
}

function convertToResponsesFormat(requestBody) {
    const messages = Array.isArray(requestBody?.messages) ? requestBody.messages : [];
    const instructions = [];
    const input = [];

    messages.forEach((message, index) => {
        if (!message || typeof message !== "object") {
            DebugLog.warn(`responses.messages[${index}] ?섎せ??message ?뺤떇`);
            return;
        }

        const role = message.role || "user";
        const content = extractTextFromMessageContent(message.content, `responses.messages[${index}]`);
        if (!content.trim()) {
            return;
        }

        if (role === "system" || role === "developer") {
            instructions.push(content.trim());
            return;
        }

        if (role !== "user" && role !== "assistant") {
            DebugLog.warn(`responses.messages[${index}] 誘몄???role: ${role}`);
            return;
        }

        // ?곗냽 媛숈? role 蹂묓빀 (Anthropic 蹂?섍낵 ?숈씪???⑦꽩)
        const last = input.length > 0 ? input[input.length - 1] : null;
        if (last && last.role === role) {
            last.content += "\n\n" + content;
        } else {
            input.push({ role, content });
        }
    });

    if (input.length === 0) {
        input.push({ role: "user", content: "Continue" });
    } else if (input[input.length - 1].role !== "user") {
        input.push({ role: "user", content: "Continue" });
    }

    const body = {
        model: requestBody?.model || "gpt-4.1",
        input,
    };

    if (instructions.length > 0) {
        body.instructions = instructions.join("\n\n");
    }
    if (requestBody?.stream != null) body.stream = requestBody.stream;
    if (requestBody?.temperature != null) body.temperature = requestBody.temperature;
    if (requestBody?.top_p != null) body.top_p = requestBody.top_p;

    if (requestBody?.max_tokens != null) {
        body.max_output_tokens = requestBody.max_tokens;
    } else if (requestBody?.max_output_tokens != null) {
        body.max_output_tokens = requestBody.max_output_tokens;
    }

    const reasoning = buildResponsesReasoningConfig(requestBody);
    if (reasoning) {
        body.reasoning = reasoning;
    }

    if (requestBody?.store != null) body.store = requestBody.store;
    if (requestBody?.metadata != null) body.metadata = requestBody.metadata;
    if (requestBody?.user != null) body.user = requestBody.user;
    if (requestBody?.text != null) body.text = requestBody.text;
    if (requestBody?.stream_options != null) body.stream_options = requestBody.stream_options;

    if (requestBody?.response_format != null) {
        DebugLog.warn("Responses 蹂?? response_format? 吏곸젒 留ㅽ븨?섏? ?딆븘 臾댁떆??);
    }
    if (requestBody?.tools != null || requestBody?.tool_choice != null) {
        DebugLog.warn("Responses 蹂?? tool 愿???꾨뱶??吏곸젒 留ㅽ븨?섏? ?딆븘 臾댁떆??);
    }

    return body;
}

function extractResponsesTextFromPart(part) {
    if (!part || typeof part !== "object") return "";
    if ((part.type === "output_text" || part.type === "text" || part.type === "summary_text" || part.type === "reasoning_text") && typeof part.text === "string") {
        return part.text;
    }
    if (part.type === "refusal" && typeof part.refusal === "string") {
        return part.refusal;
    }
    return "";
}

function extractResponsesReasoningTextFromItem(item) {
    if (!item || typeof item !== "object") return "";

    if (Array.isArray(item.summary) && item.summary.length > 0) {
        return item.summary.map(extractResponsesTextFromPart).join("");
    }

    if (Array.isArray(item.content) && item.content.length > 0) {
        return item.content.map(extractResponsesTextFromPart).join("");
    }

    return "";
}

function extractResponsesOutputText(apiResponse) {
    if (typeof apiResponse?.output_text === "string") {
        return apiResponse.output_text;
    }

    if (Array.isArray(apiResponse?.output_text)) {
        return apiResponse.output_text.map(extractResponsesTextFromPart).join("");
    }

    const output = Array.isArray(apiResponse?.output) ? apiResponse.output : [];
    const segments = [];

    output.forEach((item) => {
        if (!item || typeof item !== "object") return;

        if (item.type === "message" && item.role === "assistant") {
            segments.push((Array.isArray(item.content) ? item.content : []).map(extractResponsesTextFromPart).join(""));
            return;
        }

        if (item.type === "output_text") {
            segments.push(extractResponsesTextFromPart(item));
        }
    });

    return segments.join("");
}

function extractResponsesReasoningText(apiResponse) {
    const output = Array.isArray(apiResponse?.output) ? apiResponse.output : [];
    const segments = [];

    output.forEach((item) => {
        if (!item || typeof item !== "object") return;
        if (item.type === "reasoning") {
            const text = extractResponsesReasoningTextFromItem(item);
            if (text) segments.push(text);
        }
    });

    return segments.join("\n\n");
}

function formatThinkingContent(reasoningText, responseText) {
    const finalText = responseText || "";
    if (!reasoningText) return finalText;
    return finalText
        ? `<thinking>\n${reasoningText}\n</thinking>\n\n${finalText}`
        : `<thinking>\n${reasoningText}\n</thinking>`;
}

function mapResponsesFinishReason(apiResponse) {
    const reason = apiResponse?.incomplete_details?.reason || apiResponse?.reason;
    if (reason === "max_output_tokens" || reason === "max_tokens") {
        return "length";
    }
    return "stop";
}

function convertResponsesToOpenAIResponse(apiResponse, options = {}) {
    const responseText = extractResponsesOutputText(apiResponse);
    const reasoningText = extractResponsesReasoningText(apiResponse);

    if (!responseText && !reasoningText) {
        DebugLog.warn("Responses ?묐떟?먯꽌 assistant ?띿뒪?몃? 李얠? 紐삵븿");
    }

    const finalText = formatThinkingContent(reasoningText, responseText);
    const usage = apiResponse?.usage ? {
        prompt_tokens: apiResponse.usage.input_tokens,
        completion_tokens: apiResponse.usage.output_tokens,
        total_tokens: apiResponse.usage.total_tokens
            ?? ((apiResponse.usage.input_tokens || 0) + (apiResponse.usage.output_tokens || 0)),
    } : undefined;

    return {
        id: apiResponse?.id || options.id || `resp-${Date.now()}`,
        object: "chat.completion",
        created: apiResponse?.created_at || options.created || Math.floor(Date.now() / 1000),
        model: apiResponse?.model || options.model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: finalText,
            },
            finish_reason: mapResponsesFinishReason(apiResponse),
        }],
        usage,
    };
}

function normalizeResponsesError(error, responseText, status) {
    let message = error?.message || `${status || 500} Responses ?묐떟 ?ㅻ쪟`;

    if (responseText) {
        try {
            const parsed = JSON.parse(responseText);
            message = parsed.error?.message || parsed.message || message;
        } catch {
            message = responseText;
        }
    }

    return {
        error: {
            message: `Responses API ?붿껌 ?ㅽ뙣: ${message}`,
            type: "responses_error",
            code: status,
        },
    };
}

// ============================================================
// Custom endpoint interceptor
// ============================================================
const Interceptor = {
    originalFetch: null,
    active: false,

    async interceptAndSend(requestBody) {

        const s = getSettings();
        const isAnthropic = s.endpoint === "anthropic" || s.endpoint === "anthropic-thinking";
        const isThinking = s.endpoint === "anthropic-thinking";
        const isResponses = s.endpoint === "responses";
        const isPassthrough = s.endpoint === "passthrough";
        const url = buildTargetUrl(requestBody);

        DebugLog.info(`?붾뱶?ъ씤?? ${s.endpoint}${isThinking ? " (異붾줎)" : ""} ??${url}`);

        const accept = isAnthropic ? "application/json" : (requestBody.stream ? "text/event-stream" : "application/json");
        const headers = buildCustomHeaders(requestBody, accept);

        // body ?뺣━ (怨듯넻)
        let body = { ...requestBody };
        delete body.custom_url;
        delete body.api_key_custom;
        delete body.reverse_proxy;
        delete body.proxy_password;
        for (const key of Object.keys(body)) {
            if (body[key] === undefined) delete body[key];
        }

        if (isPassthrough) {
            // === ?⑥뒪?ㅻ（: SillyTavern ?꾩슜 ?뚮씪誘명꽣留??쒓굅?섍퀬 洹몃?濡??꾨떖 ===
            delete body.chat_completion_source;
            delete body.user_name;
            delete body.char_name;
            delete body.group_names;
            delete body.enable_web_search;
            delete body.request_images;
            delete body.request_image_resolution;
            delete body.request_image_aspect_ratio;
            delete body.custom_prompt_post_processing;
            delete body.custom_include_body;
            delete body.custom_exclude_body;
            delete body.custom_include_headers;
            delete body.type;

            // 遺덊븘?뷀븳 SillyTavern ?꾩슜 ?꾨뱶 ?쒓굅
            delete body.include_reasoning;
            delete body.reasoning_effort;

            // logprobs: normalize numeric values to boolean when needed.
            if (body.logprobs != null && typeof body.logprobs !== "boolean") {
                body.logprobs = !!body.logprobs;
                DebugLog.info("logprobs ???蹂?? number ??boolean");
            }

            // 鍮?content 硫붿떆吏 ?쒓굅
            if (Array.isArray(body.messages)) {
                body.messages = body.messages.filter((m) => {
                    const c = typeof m.content === "string" ? m.content.trim()
                        : Array.isArray(m.content) ? m.content.map(b => b.text || "").join("").trim()
                        : "";
                    return !!c;
                });
            }

            DebugLog.info("?⑥뒪?ㅻ（ 紐⑤뱶: SillyTavern ?뚮씪誘명꽣 ?뺣━ ???꾨떖");

            // ?⑥뒪?ㅻ（ body ?곸꽭 ?붾쾭洹?            DebugLog.info(`  [?⑥뒪?ㅻ（ body] ?? [${Object.keys(body).join(", ")}]`);
            if (body.messages?.length > 0) {
                const roles = body.messages.map((m, i) => `[${i}]${m.role}`).join(" ");
                DebugLog.info(`  [?⑥뒪?ㅻ（ body] roles: ${roles}`);
            }
        } else if (isAnthropic) {
            // === Anthropic ?щ㎎ 蹂??===
            DebugLog.info("OpenAI ??Anthropic ?щ㎎ 蹂??以?..");

            // 蹂?????먮낯 濡쒓렇
            if (body.messages?.length > 0) {
                const roles = body.messages.map((m, i) => `[${i}]${m.role}`).join(" ");
                DebugLog.info(`蹂????roles: ${roles}`);
            }

            // temperature + top_p ?숈떆 ?꾩넚 諛⑹?
            if (body.temperature != null && body.top_p != null) {
                DebugLog.warn("top_p ?쒓굅 (temperature? ?숈떆 ?ъ슜 遺덇?)");
                delete body.top_p;
            }

            const model = body.model || "claude-sonnet-4.5";
            const params = {
                max_tokens: body.max_tokens || 8192,
                temperature: body.temperature,
                top_p: body.top_p,
                stream: body.stream,
                thinking: isThinking,
                thinkingBudget: s.thinkingBudget || 10000,
                adaptiveThinking: !!s.adaptiveThinking,
            };

            body = convertToAnthropicFormat(body.messages || [], model, params);
            DebugLog.info(`蹂???꾨즺: system ${body.system ? "?덉쓬" : "?놁쓬"}, messages ${body.messages.length}媛?{isThinking ? ", 異붾줎 ON" : ""}`);
        } else {
            // Responses??ST??OpenAI-style ?낅젰??諛쏆? ??2李??대뙌??蹂?섏씠 ?꾩슂
            if (body.temperature != null && body.top_p != null) {
                DebugLog.warn("top_p ?쒓굅 (temperature? ?숈떆 ?ъ슜 遺덇?)");
                delete body.top_p;
            }

            delete body.chat_completion_source;
            delete body.user_name;
            delete body.char_name;
            delete body.group_names;
            delete body.enable_web_search;
            delete body.request_images;
            delete body.request_image_resolution;
            delete body.request_image_aspect_ratio;
            delete body.custom_prompt_post_processing;
            delete body.custom_include_body;
            delete body.custom_exclude_body;
            delete body.custom_include_headers;
            delete body.type;

            if (!isResponses) {
                delete body.include_reasoning;
                delete body.reasoning_effort;
                delete body.reasoning;
            }

            if (s.removePrefill && body.messages?.length > 0) {
                let removed = 0;
                while (body.messages.length > 1 && body.messages[body.messages.length - 1].role === "assistant") {
                    const removedMessage = body.messages.pop();
                    DebugLog.warn(`?꾨━???쒓굅: [${removedMessage.role}]`);
                    removed++;
                }
                if (removed > 0) DebugLog.info(`${removed}媛??꾨━???쒓굅??);
            }

            if (s.trimAssistant && body.messages?.length > 0) {
                for (const message of body.messages) {
                    if (message.role === "assistant" && typeof message.content === "string") {
                        const original = message.content;
                        message.content = message.content.trimEnd();
                        if (original !== message.content) {
                            DebugLog.warn(`assistant ??怨듬갚 ?쒓굅 (${original.length} ??${message.content.length}??`);
                        }
                    }
                }
            }

            if (s.forceLastUser && body.messages?.length > 0) {
                const last = body.messages[body.messages.length - 1];
                if (last.role !== "user") {
                    DebugLog.warn(`留덉?留?role 蹂?? ${last.role} ??user`);
                    last.role = "user";
                }
            }

            // logprobs: normalize numeric values to boolean when needed.
            if (body.logprobs != null && typeof body.logprobs !== "boolean") {
                body.logprobs = !!body.logprobs;
                DebugLog.info("logprobs ???蹂?? number ??boolean");
            }

            if (isResponses) {
                DebugLog.info("OpenAI ??Responses ?щ㎎ 蹂??以?..");
                body = convertToResponsesFormat(body);
                DebugLog.info(`蹂???꾨즺: instructions ${body.instructions ? "?덉쓬" : "?놁쓬"}, input ${body.input.length}媛?{body.reasoning ? ", reasoning ON" : ""}`);
            }
        }

        // ?붾쾭洹?濡쒓렇
        DebugLog.request("POST", url, headers, body);

        // ?곣봺???붿껌 body ?듭떖 ?뚮씪誘명꽣 ?붾쾭洹??곣봺??        DebugLog.info(`?곣봺???붿껌 遺꾩꽍 ?곣봺??);
        DebugLog.info(`  紐⑤뱶: ${s.endpoint}`);
        DebugLog.info(`  URL: ${url}`);
        DebugLog.info(`  紐⑤뜽: ${body.model || "(?놁쓬)"}`);
        DebugLog.info(`  stream: ${body.stream ?? false}`);
        DebugLog.info(`  temperature: ${body.temperature ?? "(?놁쓬)"}`);

        if (isPassthrough) {
            DebugLog.info(`  ?⑥뒪?ㅻ（ body ?? [${Object.keys(body).join(", ")}]`);
        } else if (isResponses) {
            const instructionsText = typeof body.instructions === "string" ? body.instructions : "";
            const totalInputLen = Array.isArray(body.input)
                ? body.input.reduce((sum, item) => sum + extractTextFromMessageContent(item?.content).length, 0)
                : 0;
            const inputPreview = Array.isArray(body.input)
                ? previewText(body.input.map((item) => `[${item.role}] ${extractTextFromMessageContent(item?.content)}`).join("\n"))
                : "";

            DebugLog.info(`  instructions 湲몄씠: ${instructionsText.length}??);
            DebugLog.info(`  instructions preview: ${previewText(instructionsText) || "(?놁쓬)"}`);
            DebugLog.info(`  input: ${body.input?.length || 0}媛?);
            DebugLog.info(`  input 珥?湲몄씠: ${totalInputLen}??);
            DebugLog.info(`  input preview: ${inputPreview || "(?놁쓬)"}`);
            DebugLog.info(`  max_output_tokens: ${body.max_output_tokens ?? "(?놁쓬)"}`);
            DebugLog.info(`  reasoning: ${body.reasoning ? JSON.stringify(body.reasoning) : "???놁쓬"}`);
        } else {
            DebugLog.info(`  thinking ?꾨뱶: ${body.thinking ? JSON.stringify(body.thinking) : "???놁쓬"}`);
            DebugLog.info(`  max_tokens: ${body.max_tokens}`);
            DebugLog.info(`  messages: ${body.messages?.length || 0}媛?);
            if (body.system) {
                const sysLen = Array.isArray(body.system)
                    ? body.system.map((item) => item.text?.length || 0).reduce((a, b) => a + b, 0)
                    : (typeof body.system === "string" ? body.system.length : 0);
                DebugLog.info(`  system 湲몄씠: ${sysLen}??);
            }
            const totalMsgLen = (body.messages || []).reduce((sum, message) => {
                if (typeof message.content === "string") return sum + message.content.length;
                if (Array.isArray(message.content)) return sum + message.content.reduce((acc, part) => acc + (part.text?.length || 0), 0);
                return sum;
            }, 0);
            DebugLog.info(`  硫붿떆吏 珥?湲몄씠: ${totalMsgLen}??);
        }
        DebugLog.info(`?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺??);

        const proxyUrl = `/proxy/${encodeURIComponent(url)}`;
        const credentials = s.basicAuthCompat ? "include" : "omit";
        DebugLog.info(`credentials: ${credentials}`);

        const startTime = Date.now();
        DebugLog.info(`?깍툘 fetch ?쒖옉...`);
        const response = await this.originalFetch.call(window, proxyUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            credentials,
        });
        const elapsed = Date.now() - startTime;

        if (!response.ok) {
            const errText = await response.clone().text();
            DebugLog.response(response.status, response.statusText, errText);
            DebugLog.error(`???붿껌 ?ㅽ뙣 (${elapsed}ms)`);
            DebugLog.error(`  status: ${response.status}`);
            DebugLog.error(`  ?먮윭 ?댁슜: ${errText.substring(0, 500)}`);

            if (isAnthropic) {
                let errMsg = `${response.status} ${response.statusText}`;
                try {
                    const errData = JSON.parse(errText);
                    errMsg = errData.error?.message || errData.message || errMsg;
                } catch {}
                return new Response(JSON.stringify({
                    error: { message: errMsg, type: "api_error", code: response.status },
                }), {
                    status: response.status,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (isResponses) {
                return new Response(JSON.stringify(normalizeResponsesError(new Error(response.statusText), errText, response.status)), {
                    status: response.status,
                    headers: { "Content-Type": "application/json" },
                });
            }
        } else {
            DebugLog.response(response.status, response.statusText, "(?묐떟 ?섏떊)");
            DebugLog.info(`???붿껌 ?깃났 (${elapsed}ms)`);
            DebugLog.info(`  ?깍툘 ?ㅽ듃?뚰겕 ?뚯슂: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}珥?`);
            const respHeaders = {};
            response.headers.forEach((v, k) => { respHeaders[k] = v; });
            DebugLog.info(`  ?묐떟 ?ㅻ뜑: ${JSON.stringify(respHeaders)}`);
        }

        if (isAnthropic && response.ok) {
            try {
                return await this.convertAnthropicResponse(response, body.stream);
            } catch (e) {
                DebugLog.error("Anthropic ?묐떟 蹂???ㅽ뙣:", String(e));
                return new Response(JSON.stringify({
                    choices: [{ message: { role: "assistant", content: `[MFA] ?묐떟 蹂???ㅻ쪟: ${e.message}` }, index: 0, finish_reason: "stop" }],
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
        }

        if (isResponses && response.ok) {
            try {
                return await this.handleResponsesResponse(response, {
                    stream: !!body.stream,
                    model: body.model,
                });
            } catch (e) {
                DebugLog.error("Responses ?묐떟 蹂???ㅽ뙣:", String(e));
                return new Response(JSON.stringify(normalizeResponsesError(e, null, 500)), {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }

        // ?곣봺??passthrough/openai: 鍮꾩뒪?몃━諛띿씪 ??clone?쇰줈 ?묐떟 濡쒓렇 ?곣봺??        if (response.ok && !body.stream && getSettings().debugLog) {
            try {
                const cloned = response.clone();
                cloned.json().then(data => {
                    const content = data.choices?.[0]?.message?.content || "";
                    const model = data.model || "(?놁쓬)";
                    const usage = data.usage;
                    DebugLog.info(`?곣봺???⑥뒪?ㅻ（ ?묐떟 ?곣봺??);
                    DebugLog.info(`  紐⑤뜽: ${model}`);
                    if (usage) {
                        DebugLog.info(`  prompt_tokens: ${usage.prompt_tokens || 0}`);
                        DebugLog.info(`  completion_tokens: ${usage.completion_tokens || 0}`);
                    }
                    DebugLog.info(`  蹂몃Ц 湲몄씠: ${content.length}??);
                    DebugLog.add("RES", `?곣봺???묐떟 蹂몃Ц ?곣봺??n${content}\n?곣봺???묐떟 ???곣봺??);
                }).catch(() => {});
            } catch {}
        }

        return response;
    },

    async convertAnthropicResponse(response, isStream) {
        if (isStream) {
            // ?ㅽ듃由щ컢: Anthropic SSE ??OpenAI SSE 蹂??            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = ""; // 遺덉셿?꾪븳 ?쇱씤 踰꾪띁
            let inThinking = false; // thinking 釉붾줉 ?곹깭 異붿쟻
            let thinkingAccum = ""; // 異붾줎 ?댁슜 ?꾩쟻
            let textAccum = ""; // 蹂몃Ц ?댁슜 ?꾩쟻
            let streamStartTime = Date.now();
            let firstChunkTime = null;
            let doneSent = false;

            const logAnthropicSummary = () => {
                const streamElapsed = Date.now() - streamStartTime;
                const ttfb = firstChunkTime ? firstChunkTime - streamStartTime : 0;
                DebugLog.info(`?곣봺???ㅽ듃由щ컢 ?꾨즺 ?곣봺??);
                DebugLog.info(`  珥??뚯슂: ${streamElapsed}ms (${(streamElapsed/1000).toFixed(1)}珥?`);
                DebugLog.info(`  TTFB (泥?泥?겕): ${ttfb}ms`);
                DebugLog.info(`  蹂몃Ц: ${textAccum.length}??);
                if (thinkingAccum) {
                    DebugLog.info(`  ??異붾줎: ${thinkingAccum.length}??);
                    DebugLog.add("REQ", `?곣봺??異붾줎 ?댁슜 ?곣봺??n${thinkingAccum}\n?곣봺??異붾줎 ???곣봺??);
                } else {
                    DebugLog.info(`  異붾줎: ???놁쓬`);
                }
                DebugLog.info(`?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺??);
            };

            const finalizeAnthropic = (controller) => {
                if (doneSent) return;
                doneSent = true;
                if (inThinking) {
                    const tag = { choices: [{ delta: { content: "\n</thinking>\n\n" }, index: 0 }] };
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(tag)}\n\n`));
                    inThinking = false;
                }
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                logAnthropicSummary();
                controller.close();
            };

            const stream = new ReadableStream({
                async pull(controller) {
                    try {
                    const { done, value } = await reader.read();
                    if (done) {
                        finalizeAnthropic(controller);
                        return;
                    }

                    if (!firstChunkTime) firstChunkTime = Date.now();

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    // 留덉?留?以꾩? 遺덉셿?꾪븷 ???덉쑝誘濡?踰꾪띁??蹂닿?
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        const dataStr = line.substring(6).trim();
                        if (!dataStr) continue;

                        try {
                            const event = JSON.parse(dataStr);

                            // message_start ??紐⑤뜽/usage ?뺣낫
                            if (event.type === "message_start" && event.message) {
                                DebugLog.info(`[?ㅽ듃由? message_start: 紐⑤뜽=${event.message.model || "?"}`);
                                if (event.message.usage) {
                                    DebugLog.info(`[?ㅽ듃由? input_tokens: ${event.message.usage.input_tokens || 0}`);
                                }
                            }
                            // message_delta ??stop_reason, output usage
                            else if (event.type === "message_delta") {
                                if (event.usage) {
                                    DebugLog.info(`[?ㅽ듃由? output_tokens: ${event.usage.output_tokens || 0}`);
                                }
                                if (event.delta?.stop_reason) {
                                    DebugLog.info(`[?ㅽ듃由? stop_reason: ${event.delta.stop_reason}`);
                                }
                            }

                            // thinking 釉붾줉 ?쒖옉
                            if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
                                inThinking = true;
                                const tag = { choices: [{ delta: { content: "<thinking>\n" }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(tag)}\n\n`));
                            }
                            // thinking delta
                            else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
                                thinkingAccum += event.delta.thinking || "";
                                const chunk = { choices: [{ delta: { content: event.delta.thinking }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                            }
                            // redacted_thinking ??Claude媛 異붾줎??寃?댄뻽????                            else if (event.type === "content_block_delta" && event.delta?.type === "redacted_thinking") {
                                if (!inThinking) {
                                    inThinking = true;
                                    const tag = { choices: [{ delta: { content: "<thinking>\n" }, index: 0 }] };
                                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(tag)}\n\n`));
                                }
                                const redacted = { choices: [{ delta: { content: "\n[REDACTED]\n" }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(redacted)}\n\n`));
                                DebugLog.warn("[?ㅽ듃由? redacted_thinking 媛먯?");
                            }
                            // content 釉붾줉 ?쒖옉 (text) ??thinking ??                            else if (event.type === "content_block_start" && event.content_block?.type === "text" && inThinking) {
                                const tag = { choices: [{ delta: { content: "\n</thinking>\n\n" }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(tag)}\n\n`));
                                inThinking = false;
                            }
                            // text delta
                            else if (event.type === "content_block_delta" && event.delta?.text) {
                                textAccum += event.delta.text || "";
                                const openAIChunk = {
                                    choices: [{ delta: { content: event.delta.text }, index: 0 }],
                                };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
                            }
                            // ?ㅽ듃由?醫낅즺
                            else if (event.type === "message_stop") {
                                finalizeAnthropic(controller);
                                return;
                            }
                            // ?ㅽ듃由?以??먮윭
                            else if (event.type === "error") {
                                const errMsg = event.error?.message || "Unknown error";
                                DebugLog.error(`[?ㅽ듃由? ?먮윭 ?대깽?? ${errMsg}`);
                                const errChunk = { choices: [{ delta: { content: `\n[Error: ${errMsg}]\n` }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(errChunk)}\n\n`));
                                finalizeAnthropic(controller);
                                return;
                            }
                        } catch { /* skip malformed JSON */ }
                    }
                    } catch (e) {
                        DebugLog.error("?ㅽ듃由??쎄린 ?ㅽ뙣:", String(e));
                        try {
                            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                            controller.close();
                        } catch { /* already closed */ }
                    }
                },
            });

            return new Response(stream, {
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
            });
        } else {
            // 鍮꾩뒪?몃━諛? Anthropic JSON ??OpenAI JSON 蹂??            let data;
            try {
                data = await response.json();
            } catch (e) {
                DebugLog.error("Anthropic ?묐떟 JSON ?뚯떛 ?ㅽ뙣:", String(e));
                return new Response(JSON.stringify({
                    choices: [{ message: { role: "assistant", content: "[MFA] ?묐떟 ?뚯떛 ?ㅽ뙣" }, index: 0, finish_reason: "stop" }],
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }

            const thinkingText = (data.content || [])
                .filter(b => b.type === "thinking")
                .map(b => b.thinking)
                .join("");

            const text = (data.content || [])
                .filter(b => b.type === "text")
                .map(b => b.text)
                .join("");

            // ?곣봺???묐떟 ?곸꽭 ?붾쾭洹??곣봺??            DebugLog.info(`?곣봺???묐떟 遺꾩꽍 ?곣봺??);
            DebugLog.info(`  紐⑤뜽: ${data.model || "(?놁쓬)"}`);
            DebugLog.info(`  stop_reason: ${data.stop_reason || "(?놁쓬)"}`);
            const contentTypes = (data.content || []).map(b => b.type);
            DebugLog.info(`  content 釉붾줉: [${contentTypes.join(", ")}] (${contentTypes.length}媛?`);
            if (data.usage) {
                DebugLog.info(`  input_tokens: ${data.usage.input_tokens || 0}`);
                DebugLog.info(`  output_tokens: ${data.usage.output_tokens || 0}`);
                if (data.usage.cache_creation_input_tokens) {
                    DebugLog.info(`  cache_creation: ${data.usage.cache_creation_input_tokens}`);
                }
                if (data.usage.cache_read_input_tokens) {
                    DebugLog.info(`  cache_read: ${data.usage.cache_read_input_tokens}`);
                }
            }
            DebugLog.info(`  蹂몃Ц 湲몄씠: ${text.length}??);
            if (thinkingText) {
                DebugLog.info(`  ??異붾줎 諛쒓껄: ${thinkingText.length}??);
                DebugLog.add("REQ", `?곣봺??異붾줎 ?댁슜 ?곣봺??n${thinkingText}\n?곣봺??異붾줎 ???곣봺??);
            } else {
                DebugLog.info(`  異붾줎: ???놁쓬`);
            }
            DebugLog.info(`?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺??);

            // thinking???덉쑝硫?<thinking> ?쒓렇濡?媛먯떥???욎뿉 遺숈엫
            let finalText = text || "[鍮??묐떟]";
            if (thinkingText) {
                finalText = `<thinking>\n${thinkingText}\n</thinking>\n\n${text}`;
            }

            const openAIResponse = {
                choices: [{
                    message: { role: "assistant", content: finalText },
                    index: 0,
                    finish_reason: data.stop_reason === "end_turn" ? "stop" : (data.stop_reason || "stop"),
                }],
                model: data.model,
                usage: data.usage ? {
                    prompt_tokens: data.usage.input_tokens,
                    completion_tokens: data.usage.output_tokens,
                    total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
                } : undefined,
            };

            DebugLog.info(`Anthropic?뭀penAI 蹂???꾨즺: 蹂몃Ц ${text.length}??{thinkingText ? ` + 異붾줎 ${thinkingText.length}?? : ""} ??理쒖쥌 ${finalText.length}??);

            return new Response(JSON.stringify(openAIResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
    },



    async handleResponsesResponse(response, options = {}) {
        // Responses???붿껌/?묐떟/?ㅽ듃由??ㅽ궎留덇? ?щ씪??ST??OpenAI 怨꾩빟?쇰줈 ?ㅼ떆 媛먯떬??
        DebugLog.info(`[Responses ?몃뱾?? stream=${options.stream}, model=${options.model}`);
        if (options.stream) {
            return this.pipeResponsesStreamAsOpenAI(response, options);
        }

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (error) {
            DebugLog.error("Responses ?묐떟 JSON ?뚯떛 ?ㅽ뙣:", String(error));
            return new Response(JSON.stringify(normalizeResponsesError(error, responseText, 502)), {
                status: 502,
                headers: { "Content-Type": "application/json" },
            });
        }

        const assistantText = extractResponsesOutputText(data);
        const reasoningText = extractResponsesReasoningText(data);
        DebugLog.info(`?곣봺??Responses ?묐떟 遺꾩꽍 ?곣봺??);
        DebugLog.info(`  紐⑤뜽: ${data.model || "(?놁쓬)"}`);
        DebugLog.info(`  status: ${data.status || "(?놁쓬)"}`);
        DebugLog.info(`  finish_reason: ${mapResponsesFinishReason(data)}`);
        DebugLog.info(`  output items: ${Array.isArray(data.output) ? data.output.length : 0}媛?);
        DebugLog.info(`  蹂몃Ц 湲몄씠: ${assistantText.length}??);
        if (reasoningText) {
            DebugLog.info(`  異붾줎 湲몄씠: ${reasoningText.length}??);
            DebugLog.add("REQ", `?곣봺??Responses 異붾줎 ?댁슜 ?곣봺??n${reasoningText}\n?곣봺??Responses 異붾줎 ???곣봺??);
        } else {
            DebugLog.info("  異붾줎: ???놁쓬");
        }
        DebugLog.info(`?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺??);

        const openAIResponse = convertResponsesToOpenAIResponse(data, {
            id: options.id,
            model: options.model,
            created: options.created,
        });

        return new Response(JSON.stringify(openAIResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    },

    async pipeResponsesStreamAsOpenAI(response, options = {}) {
        DebugLog.info(`[Responses ?ㅽ듃由? ?뚯씠???쒖옉`);
        const reader = response.body?.getReader?.();
        if (!reader) {
            DebugLog.error("[Responses ?ㅽ듃由? reader ?앹꽦 ?ㅽ뙣");
            return new Response(JSON.stringify(normalizeResponsesError(new Error("Responses ?ㅽ듃由?body ?놁쓬"), null, 502)), {
                status: 502, headers: { "Content-Type": "application/json" },
            });
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let inThinking = false;
        let thinkingAccum = "";
        let textAccum = "";
        let streamStartTime = Date.now();
        let firstChunkTime = null;
        let doneSent = false;
        let sseEventType = "";

        const logSummary = () => {
            const elapsed = Date.now() - streamStartTime;
            const ttfb = firstChunkTime ? firstChunkTime - streamStartTime : 0;
            DebugLog.info(`?곣봺??Responses ?ㅽ듃由щ컢 ?꾨즺 ?곣봺??);
            DebugLog.info(`  珥??뚯슂: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}珥?`);
            DebugLog.info(`  TTFB: ${ttfb}ms`);
            DebugLog.info(`  蹂몃Ц: ${textAccum.length}??);
            if (thinkingAccum) {
                DebugLog.info(`  異붾줎: ${thinkingAccum.length}??);
                DebugLog.add("REQ", `?곣봺??Responses 異붾줎 ?댁슜 ?곣봺??n${thinkingAccum}\n?곣봺??Responses 異붾줎 ???곣봺??);
            } else {
                DebugLog.info("  異붾줎: ???놁쓬");
            }
            DebugLog.info("?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺?곣봺??);
        };

        const finalize = (controller) => {
            if (doneSent) return;
            doneSent = true;
            if (inThinking) {
                const tag = { choices: [{ delta: { content: "\n</thinking>\n\n" }, index: 0 }] };
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(tag)}\n\n`));
                inThinking = false;
            }
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            logSummary();
            controller.close();
        };

        const stream = new ReadableStream({
            async pull(controller) {
                // 硫뷀??곗씠???꾩슜 泥?겕?먯꽌 硫덉텛吏 ?딅룄濡?                // ?ㅼ젣 content瑜?enqueue?섍굅???ㅽ듃由쇱씠 ?앸궇 ?뚭퉴吏 怨꾩냽 ?쎌쓬
                while (true) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        finalize(controller);
                        return;
                    }

                    if (!firstChunkTime) firstChunkTime = Date.now();

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    let didEnqueue = false;

                    for (const line of lines) {
                        if (line.startsWith("event:")) {
                            sseEventType = line.slice(6).trim();
                            continue;
                        }
                        if (!line.startsWith("data:")) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr) continue;
                        if (dataStr === "[DONE]") {
                            finalize(controller);
                            return;
                        }

                        let event;
                        try { event = JSON.parse(dataStr); } catch { continue; }

                        const type = event.type || sseEventType;

                        // ?띿뒪???명?
                        if (type === "response.output_text.delta") {
                            const text = event.delta || "";
                            if (!text) continue;
                            if (inThinking) {
                                const tag = { choices: [{ delta: { content: "\n</thinking>\n\n" }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(tag)}\n\n`));
                                inThinking = false;
                            }
                            textAccum += text;
                            const chunk = { choices: [{ delta: { content: text }, index: 0 }] };
                            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                            didEnqueue = true;
                        }
                        // 異붾줎 ?명?
                        else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
                            const text = event.delta || "";
                            if (!text) continue;
                            if (!inThinking) {
                                inThinking = true;
                                const tag = { choices: [{ delta: { content: "<thinking>\n" }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(tag)}\n\n`));
                            }
                            thinkingAccum += text;
                            const chunk = { choices: [{ delta: { content: text }, index: 0 }] };
                            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                            didEnqueue = true;
                        }
                        // 嫄곕? ?명?
                        else if (type === "response.refusal.delta") {
                            const text = event.delta || "";
                            if (text) {
                                textAccum += text;
                                const chunk = { choices: [{ delta: { content: text }, index: 0 }] };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                                didEnqueue = true;
                            }
                        }
                        // ?먮윭
                        else if (type === "response.failed" || type === "error") {
                            const errMsg = event.error?.message || event.message || "Unknown error";
                            DebugLog.error(`[Responses ?ㅽ듃由? ${errMsg}`);
                            const errChunk = { choices: [{ delta: { content: `\n[Error: ${errMsg}]\n` }, index: 0 }] };
                            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(errChunk)}\n\n`));
                            finalize(controller);
                            return;
                        }
                        // ?ㅽ듃由?醫낅즺
                        else if (type === "response.completed" || type === "response.incomplete") {
                            finalize(controller);
                            return;
                        }
                        // ?섎㉧吏 (硫뷀??곗씠????: 臾댁떆
                    }

                    if (didEnqueue) return; // 肄섑뀗痢??꾨떖 ?꾨즺 ??pull 醫낅즺
                    // 肄섑뀗痢??녿뒗 硫뷀??곗씠??泥?겕 ??while 猷⑦봽濡??ㅼ쓬 泥?겕 ?쎄린
                } catch (e) {
                    DebugLog.error("Responses ?ㅽ듃由??쎄린 ?ㅽ뙣:", String(e));
                    try {
                        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                        controller.close();
                    } catch { /* already closed */ }
                    return;
                }
                } // while
            },
        });

        return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
        });
    },

    install() {
        if (this.active) return;
        this.originalFetch = window.fetch;
        const self = this;

        window.fetch = async function (...args) {
            const [url, options] = args;
            if (!getSettings().enabled) return self.originalFetch.apply(window, args);

            const urlStr = typeof url === "string" ? url : url?.url || "";
            const isTarget = urlStr.includes("/api/backends/chat-completions/generate") ||
                urlStr.includes("/api/backends/custom/generate");
            if (!isTarget) return self.originalFetch.apply(window, args);

            let requestBody;
            try {
                const bodyText = typeof options?.body === "string" ? options.body : await options?.body?.text?.() || "{}";
                requestBody = JSON.parse(bodyText);
            } catch { return self.originalFetch.apply(window, args); }

            if (!requestBody.custom_url) return self.originalFetch.apply(window, args);

            DebugLog.info("Custom endpoint request intercepted");

            try {
                return await self.interceptAndSend(requestBody);
            } catch (error) {
                DebugLog.error("?명꽣?됲듃 ?ㅽ뙣:", String(error));
                toastr.error(`[MFA] ${error.message}`);
                try {
                    return await self.originalFetch.apply(window, args);
                } catch {
                    return new Response(JSON.stringify({ error: { message: error.message } }), {
                        status: 500, headers: { "Content-Type": "application/json" }
                    });
                }
            }
        };

        this.active = true;
        DebugLog.info("?명꽣?됲꽣 ?ㅼ튂 ?꾨즺");
    },

    uninstall() {
        if (!this.active || !this.originalFetch) return;
        window.fetch = this.originalFetch;
        this.active = false;
        DebugLog.info("?명꽣?됲꽣 ?쒓굅??);
    },
};

// ============================================================
// UI
// ============================================================
function updateStatus() {
    const s = getSettings();
    const el = $("#cpi_status");

    if (!s.enabled) {
        el.text("Disabled").css("color", "#f44336");
        return;
    }

    if (Interceptor.active) {
        const labels = {
            "anthropic": "Anthropic Messages body",
            "anthropic-thinking": "Anthropic Messages body + thinking",
            "openai": "OpenAI chat body cleanup",
            "passthrough": "Passthrough cleanup only",
            "responses": "Responses body conversion",
        };
        el.text(`Enabled - ${labels[s.endpoint] || s.endpoint}`).css("color", "#4CAF50");
    } else {
        el.text("Enabled, waiting for install").css("color", "#FF9800");
    }
}

// ============================================================
// 珥덇린??// ============================================================
jQuery(async () => {
    const html = await loadSettingsHtml();
    $("#extensions_settings").append(html);

    $("#cpi_enabled").on("change", function () {
        const s = getSettings();
        s.enabled = $(this).prop("checked");
        saveSettings();
        s.enabled ? Interceptor.install() : Interceptor.uninstall();
        s.enabled ? toastr.success("[MFA] Enabled") : toastr.info("[MFA] Disabled");
        updateStatus();
    });

    $("#cpi_endpoint").on("change", function () {
        const s = getSettings();
        s.endpoint = $(this).val();
        saveSettings();
        DebugLog.info("Body mode:", s.endpoint);
        $(".cpi-openai-only").toggle(s.endpoint === "openai" || s.endpoint === "responses");
        $(".cpi-thinking-only").toggle(s.endpoint === "anthropic-thinking");
        $(".cpi-passthrough-only").toggle(s.endpoint === "passthrough");
        updateStatus();
    });

    $("#cpi_adaptive_thinking").on("change", function () {
        const s = getSettings();
        s.adaptiveThinking = $(this).prop("checked");
        saveSettings();
        $(".cpi-budget-row").toggle(!s.adaptiveThinking);
        DebugLog.info("Adaptive Thinking:", s.adaptiveThinking ? "ON" : "OFF");
    });

    $("#cpi_thinking_budget").on("change", function () {
        const s = getSettings();
        s.thinkingBudget = parseInt($(this).val()) || 10000;
        saveSettings();
        DebugLog.info("Thinking budget:", s.thinkingBudget);
    });

    $("#cpi_remove_prefill").on("change", function () {
        const s = getSettings();
        s.removePrefill = $(this).prop("checked");
        saveSettings();
        DebugLog.info("Remove prefill:", s.removePrefill ? "ON" : "OFF");
    });

    $("#cpi_trim_assistant").on("change", function () {
        const s = getSettings();
        s.trimAssistant = $(this).prop("checked");
        saveSettings();
        DebugLog.info("Assistant trim:", s.trimAssistant ? "ON" : "OFF");
    });

    $("#cpi_force_last_user").on("change", function () {
        const s = getSettings();
        s.forceLastUser = $(this).prop("checked");
        saveSettings();
        DebugLog.info("Force last user:", s.forceLastUser ? "ON" : "OFF");
    });

    $("#cpi_basic_auth_compat").on("change", function () {
        const s = getSettings();
        s.basicAuthCompat = $(this).prop("checked");
        saveSettings();
        DebugLog.info("Credentials include:", s.basicAuthCompat ? "ON" : "OFF");
    });

    $("#cpi_debug_log").on("change", function () {
        const s = getSettings();
        s.debugLog = $(this).prop("checked");
        saveSettings();
        s.debugLog ? $("#cpi_log_panel").slideDown(150) && DebugLog.render() : $("#cpi_log_panel").slideUp(150);
    });

    $("#cpi_clear_log").on("click", () => { DebugLog.clear(); toastr.info("[MFA] Log cleared"); });

    $("#cpi_log_content").on("click", ".cpi-fold-btn", function () {
        const fold = $(this).closest(".cpi-fold");
        const action = $(this).data("action");
        if (action === "expand") {
            fold.find(".cpi-fold-short").hide();
            fold.find(".cpi-fold-long").show();
        } else {
            fold.find(".cpi-fold-long").hide();
            fold.find(".cpi-fold-short").show();
        }
    });

    $("#cpi_scroll_bottom").on("click", () => {
        const el = $("#cpi_log_content");
        el.scrollTop(el[0]?.scrollHeight || 0);
    });

    $("#cpi_fold_all").on("click", function () {
        const el = $("#cpi_log_content");
        const isAllFolded = el.find(".cpi-fold-long:visible").length === 0;
        if (isAllFolded) {
            el.find(".cpi-fold-short").hide();
            el.find(".cpi-fold-long").show();
            $(this).val("Fold all");
        } else {
            el.find(".cpi-fold-long").hide();
            el.find(".cpi-fold-short").show();
            $(this).val("Expand all");
        }
    });

    const s = getSettings();
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (s[k] === undefined) s[k] = v;
    }

    $("#cpi_enabled").prop("checked", s.enabled);
    $("#cpi_endpoint").val(s.endpoint);
    $("#cpi_thinking_budget").val(s.thinkingBudget || 10000);
    $("#cpi_adaptive_thinking").prop("checked", !!s.adaptiveThinking);
    $(".cpi-budget-row").toggle(!s.adaptiveThinking);
    $("#cpi_remove_prefill").prop("checked", s.removePrefill);
    $("#cpi_trim_assistant").prop("checked", s.trimAssistant);
    $("#cpi_force_last_user").prop("checked", s.forceLastUser);
    $("#cpi_basic_auth_compat").prop("checked", s.basicAuthCompat);
    $("#cpi_debug_log").prop("checked", s.debugLog);

    $(".cpi-openai-only").toggle(s.endpoint === "openai" || s.endpoint === "responses");
    $(".cpi-thinking-only").toggle(s.endpoint === "anthropic-thinking");
    $(".cpi-passthrough-only").toggle(s.endpoint === "passthrough");
    if (!s.debugLog) $("#cpi_log_panel").hide();

    if (s.enabled) Interceptor.install();
    updateStatus();
    DebugLog.info("MFA loaded");
});
