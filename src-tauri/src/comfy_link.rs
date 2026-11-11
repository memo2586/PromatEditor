use super::*;

#[derive(Clone, Default, Serialize, Deserialize)]
pub(super) struct LinkStore {
    runs: Vec<Run>,
    #[serde(default)]
    probes: Vec<Value>,
    #[serde(skip, default = "id")]
    session: String,
    #[serde(skip)]
    network_cache: Option<(Result<Value, String>, Result<Value, String>)>,
    #[serde(skip)]
    defer_dispatch: bool,
    #[serde(skip)]
    live: Value,
}

#[derive(Clone, Serialize, Deserialize)]
struct Run {
    request_id: String,
    #[serde(default)]
    project_path: Option<String>,
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    probe: Option<Value>,
    server_url: String,
    client_id: String,
    fingerprint: String,
    created: String,
    snapshot: Value,
    state: EditingState,
    status: String,
    #[serde(default)]
    prompt_id: Option<String>,
    #[serde(default)]
    outputs: Vec<Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    execution_error: Value,
    #[serde(default)]
    seed_before: Option<Generation>,
    #[serde(default)]
    seed_after: Option<Generation>,
    #[serde(default)]
    seed_committed: bool,
    #[serde(default)]
    seed_used: bool,
    #[serde(default)]
    film_hidden: bool,
    #[serde(default)]
    feedback_seen: bool,
}
fn terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "rejected" | "cancelled")
}
fn uncertain(status: &str) -> bool {
    matches!(status, "dispatching" | "claimed" | "unknown")
}
fn issue(kind: &str, message: impl Into<String>) -> Value {
    json!({"kind":kind,"message":message.into(),"blocking":true})
}
fn canonical(url: &str) -> String {
    url.trim()
        .trim_end_matches('/')
        .replace("localhost", "127.0.0.1")
}
fn lora_matches(name: &str, key: &str) -> bool {
    fn normalize(value: &str) -> String {
        let value = value.replace('\\', "/").to_lowercase();
        for extension in [".safetensors", ".ckpt", ".pt", ".bin"] {
            if let Some(stem) = value.strip_suffix(extension) {
                return stem.to_string();
            }
        }
        value
    }
    let name = normalize(name);
    let key = normalize(key);
    name == key || !name.contains('/') && key.rsplit('/').next() == Some(name.as_str())
}
fn snapshot_used(prompt: &Value, sid: &Value) -> bool {
    fn visit(node: &str, graph: &Value, seen: &mut HashSet<String>) {
        if !seen.insert(node.to_string()) {
            return;
        }
        for input in graph[node]["inputs"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(_, v)| v)
        {
            if input
                .as_array()
                .is_some_and(|v| v.len() == 2 && v[1].is_u64())
            {
                if let Some(id) = input[0].as_str() {
                    visit(id, graph, seen);
                }
            }
        }
    }
    let mut seen = HashSet::new();
    for node in prompt[4]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        visit(node, &prompt[2], &mut seen);
    }
    prompt[3]["extra_pnginfo"]["workflow"]["extra"]["prompt_editor_snapshots"]
        .as_object()
        .into_iter()
        .flatten()
        .any(|(node, state)| seen.contains(node) && state["snapshot_id"] == *sid)
}
fn output_uses_snapshot(prompt: &Value, sid: &Value, node: &str) -> bool {
    let mut branch = prompt.clone();
    branch[4] = json!([node]);
    snapshot_used(&branch, sid)
}

fn link_get(url: &str, path: &str) -> Result<Value, String> {
    let url = AppState::validate_comfy_url(url)?;
    let response = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!("{url}{path}"))
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let value: Value = response.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(value["error"]
            .as_str()
            .unwrap_or("请更新 ComfyUI Bridge 并刷新浏览器页面")
            .into());
    }
    Ok(value)
}

// Keep background network waits outside the editor mutex.
pub(super) fn poll_shared(shared: &Shared) -> Result<Value, String> {
    let (url, ids) = {
        let state = shared.lock().map_err(|_| "编辑器状态不可用")?;
        (
            state.comfy_url.clone(),
            state
                .link
                .runs
                .iter()
                .filter(|r| r.server_url == state.comfy_url && !terminal(&r.status))
                .map(|r| r.request_id.clone())
                .collect::<HashSet<_>>(),
        )
    };
    let live = link_get(&url, "/prompt-editor/link")?;
    if live["protocol"] != 1 {
        return Err("请更新 ComfyUI Bridge 并刷新浏览器页面".into());
    }
    let missing = ids.iter().any(|id| {
        !live["runs"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|r| get(r, "request_id") == id)
    });
    let (queue, history) = if missing {
        (link_get(&url, "/queue")?, link_get(&url, "/history")?)
    } else {
        (Value::Null, Value::Null)
    };
    let mut state = shared.lock().map_err(|_| "编辑器状态不可用")?;
    if state.comfy_url != url {
        return Err("连接已切换，正在重新读取状态".into());
    }
    state.link.live = live.clone();
    state.apply_poll(live, queue, history, &ids)
}

pub(super) fn poll_delta_shared(shared: &Shared, p: &Value) -> Result<Value, String> {
    use sha2::Digest;
    let mut result = poll_shared(shared)?;
    let bytes = serde_json::to_vec(&json!([result["runs"], result["probes"]]))
        .map_err(|e| e.to_string())?;
    let revision = format!("{:x}", sha2::Sha256::digest(bytes));
    if get(p, "revision") == revision {
        return Ok(json!({"unchanged":true,"revision":revision,"live":result["live"]}));
    }
    result["revision"] = json!(revision);
    Ok(result)
}

// Diagnostics and browser acknowledgements never hold the editor mutex across I/O.
pub(super) fn control_shared(shared: &Shared, method: &str, p: &Value) -> Result<Value, String> {
    let (url, port, run) = {
        let state = shared.lock().map_err(|_| "编辑器状态不可用")?;
        (
            state.comfy_url.clone(),
            state.bridge_port,
            state
                .link
                .runs
                .iter()
                .find(|r| r.request_id == get(p, "request_id"))
                .cloned(),
        )
    };
    if method == "runs.queue" || method == "runs.probe.cancel" {
        if p["confirmed"] != true {
            return Err("请先确认受影响任务".into());
        }
        let mut request = p.clone();
        if method == "runs.probe.cancel" {
            let own = {
                let s = shared.lock().map_err(|_| "编辑器状态不可用")?;
                s.link
                    .runs
                    .iter()
                    .filter(|r| r.probe.as_ref().is_some_and(|v| v["id"] == p["probe_id"]))
                    .filter_map(|r| r.prompt_id.clone())
                    .collect::<HashSet<_>>()
            };
            if ids(p).iter().any(|pid| !own.contains(pid))
                || (!get(p, "prompt_id").is_empty() && !own.contains(get(p, "prompt_id")))
            {
                return Err("取消范围超出探针任务".into());
            }
            request["action"] = json!("cancel-probe");
        }
        return AppState::link_post_at(&url, "/prompt-editor/queue-action", &request);
    }
    if method == "runs.diagnostics" {
        let bridge = link_get(&url, "/prompt-editor/link");
        let started = std::time::Instant::now();
        let backend = link_get(&url, "/system_stats");
        let backend_latency_ms = backend.as_ref().ok().map(|_| started.elapsed().as_millis() as u64);
        let queue = link_get(&url, "/queue");
        return Ok(json!({"server_url":url,"editor":true,"backend_latency_ms":backend_latency_ms,
            "bridge":bridge.as_ref().is_ok_and(|v| v["protocol"] == 1),
            "bridge_error":bridge.as_ref().err(),"backend":backend.is_ok(),"backend_error":backend.as_ref().err(),
            "stats":backend.unwrap_or(Value::Null),"queue":queue.unwrap_or(Value::Null),"live":bridge.unwrap_or(Value::Null)}));
    }
    if method == "runs.free" {
        let state = shared.lock().map_err(|_| "编辑器状态不可用")?;
        if state
            .link
            .runs
            .iter()
            .any(|r| r.server_url == url && !terminal(&r.status))
        {
            return Err("请先处理队列及受理未确认任务".into());
        }
        drop(state);
        return AppState::link_post_at(&url, "/prompt-editor/free", &json!({}));
    }
    let run = run.ok_or("生成记录不存在")?;
    let token = id();
    AppState::link_post_at(
        &run.server_url,
        "/prompt-editor/locate",
        &json!({"token":token,"client_id":run.client_id,"fingerprint":run.fingerprint,"node_id":get(&run.execution_error,"node_id"),"editor_url":format!("http://127.0.0.1:{port}")}),
    )?;
    for _ in 0..20 {
        let result = link_get(
            &run.server_url,
            &format!("/prompt-editor/locate-result?token={token}"),
        )?;
        match get(&result, "status") {
            "located" => return Ok(result),
            "pending" => std::thread::sleep(Duration::from_millis(150)),
            _ => {
                return Err(result["error"]
                    .as_str()
                    .unwrap_or("节点定位未完成，请刷新浏览器后重试")
                    .into())
            }
        }
    }
    Err("浏览器未确认节点定位，请检查页面是否在线".into())
}

fn submission_revision(state: &AppState) -> Value {
    json!([
        state.editor.project.state,
        state.generation,
        state.composing,
        state.editor.project.comfy_group_targets,
        state.generation_problem()
    ])
}
// Preflight uses a point-in-time editor revision, while all network waits run unlocked.
// If the user edits during preflight, refuse the stale submission instead of changing its meaning.
pub(super) fn mutation_shared(shared: &Shared, method: &str, p: Value) -> Result<Value, String> {
    let (url, revision, ids) = {
        let s = shared.lock().map_err(|_| "编辑器状态不可用")?;
        (
            s.comfy_url.clone(),
            submission_revision(&s),
            s.link
                .runs
                .iter()
                .map(|r| r.request_id.clone())
                .collect::<HashSet<_>>(),
        )
    };
    let (live, library) = std::thread::scope(|scope| {
        let live = scope.spawn(|| link_get(&url, "/prompt-editor/link"));
        let library = scope.spawn(|| link_get(&url, "/prompt-editor/lora-library"));
        (
            live.join()
                .unwrap_or_else(|_| Err("Bridge 读取失败".into())),
            library
                .join()
                .unwrap_or_else(|_| Err("LoRA 目录读取失败".into())),
        )
    });
    let (result, added) = {
        let mut s = shared.lock().map_err(|_| "编辑器状态不可用")?;
        if s.comfy_url != url {
            return Err("连接在体检期间改变，请重新提交".into());
        }
        if get(&p, "probe_id").is_empty()
            && get(&p, "source_request").is_empty()
            && submission_revision(&s) != revision
        {
            return Err("提示词或参数在体检期间改变，请重新提交".into());
        }
        s.link.network_cache = Some((live, library));
        s.link.defer_dispatch = true;
        let result = s.link_rpc(method, p);
        s.link.network_cache = None;
        s.link.defer_dispatch = false;
        let added = s
            .link
            .runs
            .iter()
            .filter(|r| !ids.contains(&r.request_id))
            .cloned()
            .collect::<Vec<_>>();
        (result, added)
    };
    let result = result?;
    let port = { shared.lock().map_err(|_| "编辑器状态不可用")?.bridge_port };
    for (index, run) in added.iter().enumerate() {
        if let Err(error) = AppState::link_post_at(
            &run.server_url,
            "/prompt-editor/run",
            &json!({"request_id":run.request_id,"snapshot":run.snapshot,"client_id":run.client_id,"fingerprint":run.fingerprint,"editor_url":format!("http://127.0.0.1:{port}")}),
        ) {
            let mut s = shared.lock().map_err(|_| "编辑器状态不可用")?;
            let mut next = s.link.clone();
            if let Some(r) = next
                .runs
                .iter_mut()
                .find(|r| r.request_id == run.request_id)
            {
                if r.prompt_id.is_none() {
                    r.status = if error.starts_with("已拒绝：") {
                        "rejected"
                    } else {
                        "unknown"
                    }
                    .into();
                    r.error = Some(format!("{error}；先核对队列与历史"));
                }
            }
            for remaining in &added[index + 1..] {
                if let Some(r) = next
                    .runs
                    .iter_mut()
                    .find(|r| r.request_id == remaining.request_id)
                {
                    r.status = "rejected".into();
                    r.error = Some("前一项受理失败，尚未发送".into());
                }
            }
            s.persist("runs.json", &next)?;
            s.link = next;
            break;
        }
    }
    if added.is_empty() {
        return Ok(result);
    }
    let s = shared.lock().map_err(|_| "编辑器状态不可用")?;
    Ok(json!({"runs":s.link.runs,"live":s.link.live,"probes":s.link.probes,"session_id":s.link.session}))
}

pub(super) fn image_shared(shared: &Shared, p: &Value) -> Result<Value, String> {
    image_io_shared(shared, p, false)
}
pub(super) fn file_shared(shared: &Shared, p: &Value) -> Result<Value, String> {
    image_io_shared(shared, p, true)
}
fn image_io_shared(shared: &Shared, p: &Value, file: bool) -> Result<Value, String> {
    let run = shared
        .lock()
        .map_err(|_| "编辑器状态不可用")?
        .link
        .runs
        .iter()
        .find(|r| r.request_id == get(p, "request_id"))
        .cloned()
        .ok_or("生成记录不存在")?;
    if file {
        image_file(&run, p)
    } else {
        load_image(&run, p)
    }
}
fn identity(terms: &[Term]) -> Vec<String> {
    let mut counts = HashMap::new();
    terms
        .iter()
        .map(|t| {
            let key = format!("{}:{}", t.kind, t.key);
            let n = counts.entry(key.clone()).or_insert(0);
            *n += 1;
            format!("{}:{}", key, n)
        })
        .collect()
}
fn differences(current: &EditingState, target: &EditingState) -> Vec<Value> {
    let mut rows = vec![];
    for (side, a, b) in [
        ("positive", &current.positive, &target.positive),
        ("negative", &current.negative, &target.negative),
    ] {
        let ak = identity(&a.active);
        let bk = identity(&b.active);
        let mut keys = ak.clone();
        keys.extend(bk.iter().filter(|k| !ak.contains(k)).cloned());
        for key in keys {
            let from = ak.iter().position(|k| k == &key).map(|i| &a.active[i]);
            let to = bk.iter().position(|k| k == &key).map(|i| &b.active[i]);
            if from.map(Term::display) != to.map(Term::display) {
                rows.push(json!({"id":format!("{side}/{key}"),"side":side,"key":key,
                    "label":to.or(from).map(|t| &t.base),"from":from.map(Term::display),"to":to.map(Term::display),"to_weight":to.map(|t| t.weight)}));
            }
        }
        // Visual organization is captured/restored, but is not a content difference.
        let hidden = |w: &Workspace| w.hidden.iter().map(Term::display).collect::<Vec<_>>();
        if hidden(a) != hidden(b) {
            rows.push(json!({"id":format!("{side}/structure"),"side":side,"key":"structure", "label":"隐藏项", "from":hidden(a).join(", "), "to":hidden(b).join(", ")}));
        }
    }
    rows
}
fn merge_workspace(
    current: &Workspace,
    target: &Workspace,
    side: &str,
    selected: &[String],
) -> Result<Workspace, String> {
    if !selected
        .iter()
        .any(|key| key.starts_with(&format!("{side}/")))
    {
        return Ok(current.clone());
    }
    let mut w = current.clone();
    let ck = identity(&current.active);
    let tk = identity(&target.active);
    let selected_key = |k: &str| selected.contains(&format!("{side}/{k}"));
    let mut items: Vec<(String, Term)> = ck.iter().cloned().zip(w.active.clone()).collect();
    for key in ck.iter().chain(tk.iter().filter(|k| !ck.contains(k))) {
        if !selected_key(key) {
            continue;
        }
        let at = items.iter().position(|(k, _)| k == key);
        let to = tk.iter().position(|k| k == key);
        match (at, to) {
            (Some(at), Some(to)) => {
                let id = items[at].1.id.clone();
                items[at].1 = target.active[to].clone();
                items[at].1.id = id;
            }
            (Some(at), None) => {
                items.remove(at);
            }
            (None, Some(to)) => {
                let at = tk[..to]
                    .iter()
                    .rev()
                    .find_map(|k| items.iter().position(|(id, _)| id == k).map(|i| i + 1))
                    .unwrap_or(0);
                let mut term = target.active[to].clone();
                term.id = id();
                items.insert(at, (key.clone(), term));
            }
            _ => (),
        }
    }
    if selected_key("structure") {
        items.sort_by_key(|(k, _)| tk.iter().position(|id| id == k).unwrap_or(usize::MAX));
        let ids: HashMap<_, _> = tk
            .iter()
            .enumerate()
            .filter_map(|(i, k)| {
                items
                    .iter()
                    .find(|(key, _)| key == k)
                    .map(|(_, t)| (target.active[i].id.clone(), t.id.clone()))
            })
            .collect();
        w.hidden = target.hidden.clone();
        w.groups = target.groups.clone();
        for group in &mut w.groups {
            group.members = group
                .members
                .iter()
                .filter_map(|key| {
                    ids.get(key)
                        .cloned()
                        .or_else(|| w.hidden.iter().find(|t| &t.id == key).map(|t| t.id.clone()))
                })
                .collect();
        }
        w.layout.clear();
    }
    w.active = items.into_iter().map(|(_, t)| t).collect();
    w.text = w
        .active
        .iter()
        .map(Term::display)
        .collect::<Vec<_>>()
        .join(", ");
    let parsed = parser::parse(&w.text, Some(&w.active));
    if !parsed.valid || parsed.terms.len() != w.active.len() {
        return Err("所选差异会改变语法边界，整笔未应用".into());
    }
    w.active = parsed.terms;
    w.parsed_text = Some(w.text.clone());
    editor::refresh(&mut w);
    Ok(w)
}

impl AppState {
    fn link_post_at(url: &str, path: &str, data: &Value) -> Result<Value, String> {
        let url = Self::validate_comfy_url(url)?;
        let response = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(4))
            .build()
            .map_err(|e| e.to_string())?
            .post(format!("{url}{path}"))
            .json(data)
            .send()
            .map_err(|e| e.to_string())?;
        let status = response.status();
        let value: Value = response.json().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!(
                "已拒绝：{}",
                value["error"].as_str().unwrap_or("Bridge 请求失败")
            ));
        }
        Ok(value)
    }
    fn link_status(&mut self) -> Result<Value, String> {
        let live = if let Some((live, _)) = &self.link.network_cache {
            live.clone()?
        } else {
            link_get(&self.comfy_url, "/prompt-editor/link")?
        };
        if live["protocol"] != 1 {
            return Err("请更新 ComfyUI Bridge 并刷新浏览器页面".into());
        }
        self.link.live = live.clone();
        Ok(live)
    }
    fn selected_page(&self, live: &Value, client: &str) -> Result<Value, String> {
        let editor_url = format!("http://127.0.0.1:{}", self.bridge_port);
        let pages: Vec<_> = live["pages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|p| {
                p["bridges"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|b| canonical(get(b, "editor_url")) == editor_url)
            })
            .collect();
        if pages.is_empty() {
            return Err("浏览器工作流页未打开，或未连接当前编辑器节点".into());
        }
        if let Some(p) = pages.iter().find(|p| get(p, "client_id") == client) {
            return Ok((*p).clone());
        }
        if !client.is_empty() {
            return Err("选定的浏览器工作流已离线或解除绑定，请重新选择".into());
        }
        if pages.len() != 1 {
            return Err("有多个在线工作流，请选择本次生成的浏览器页面".into());
        }
        Ok(pages[0].clone())
    }
    fn link_preflight(&mut self, p: &Value) -> Value {
        let mut issues = vec![];
        if self.composing && get(p,"source_request").is_empty() {
            issues.push(issue("prompt", "请先完成输入法组词"));
        }
        if get(p, "probe_id").is_empty() && get(p, "source_request").is_empty() {
            for (w, label) in [
                (&self.editor.project.state.positive, "积极"),
                (&self.editor.project.state.negative, "消极"),
            ] {
                if let Some(error) = parser::parse(&w.text, None).error {
                    issues.push(issue("prompt", format!("{label}提示词：{error}")));
                }
            }
        }
        let mut generation = self.generation.clone();
        let mut state = if get(p, "mode") == "negative" {
            if let Some(run) = self.link.runs.iter().rev().find(|r| r.prompt_id.is_some()) {
                generation = serde_json::from_value(run.snapshot["generation"].clone())
                    .unwrap_or(generation);
                let mut state = run.state.clone();
                state.negative = self.editor.project.state.negative.clone();
                state
            } else {
                issues.push(issue("prompt", "先完成一次生成"));
                self.editor.project.state.clone()
            }
        } else {
            self.editor.project.state.clone()
        };
        match self.locked_input(p) {
            Ok(Some((locked_state, locked_generation))) => {
                state = locked_state;
                generation = locked_generation;
            }
            Ok(None) => {}
            Err(e) => issues.push(issue("prompt", e)),
        }
        if p["lock_seed"] == true
            && get(p, "probe_id").is_empty()
            && get(p, "source_request").is_empty()
        {
            // The editable seed has already advanced after acceptance. Reuse the
            // submitted seed without restoring old prompts or other parameters.
            if let Some(seed) = self.link.runs.iter().rev().find_map(|run| {
                (canonical(&run.server_url) == canonical(&self.comfy_url)
                    && run.project_path == self.project_path
                    && run.prompt_id.is_some()
                    && run.seed_used)
                    .then(|| run.snapshot["generation"]["seed"].as_u64())
                    .flatten()
            }) {
                generation.seed = seed;
            }
            generation.seed_control = "fixed".into();
        }
        for w in [&state.positive, &state.negative] {
            if let Some(e) = parser::parse(&w.text, None).error {
                issues.push(issue("prompt", e));
            }
        }
        if get(p, "probe_id").is_empty() && get(p, "source_request").is_empty() {
            if let Some(error) = self.generation_problem() {
                issues.push(issue("parameters", error));
            }
        }
        if let Err(error) = generation.validate() {
            issues.push(issue("parameters", error));
        }
        let live = match self.link_status() {
            Ok(v) => {
                self.comfy_connected = true;
                self.comfy_error = None;
                v
            }
            Err(error) => {
                self.comfy_connected = false;
                self.comfy_error = Some(error.clone());
                issues.push(issue("connection", error));
                json!({})
            }
        };
        let page = match self.selected_page(&live, get(p, "client_id")) {
            Ok(page) => page,
            Err(error) => {
                issues.push(issue("browser", error));
                Value::Null
            }
        };
        if let Some(probe) = self.link.probes.iter().find(|v| v["id"] == p["probe_id"]) {
            if !probe["client_id"].is_null()
                && (page["client_id"] != probe["client_id"]
                    || page["fingerprint"] != probe["fingerprint"])
            {
                issues.push(issue(
                    "browser",
                    "探针原工作流已切换或离线，请回到原页面或锁定新探针",
                ));
            }
        }
        if generation.enabled && !page.is_null() {
            for group in &mut generation.groups {
                if get(p, "probe_id").is_empty() && get(p, "source_request").is_empty() {
                    if let Some(target) = self.editor.project.comfy_group_targets.get(&group.name) {
                        group.bypasser_id = target.clone();
                    }
                }
                let matches: Vec<_> = page["groups"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|g| {
                        get(g, "name") == group.name
                            && (group.bypasser_id.is_empty()
                                || get(g, "bypasser_id") == group.bypasser_id)
                    })
                    .cloned()
                    .collect();
                if matches.len() != 1 {
                    issues.push(json!({"kind":"group","blocking":true,"name":group.name,"message":format!("分组“{}”目标缺失或重名，请选择同步目标", group.name),
                        "options":page["groups"].as_array().into_iter().flatten().filter(|g| get(g,"name") == group.name).collect::<Vec<_>>()}));
                }
            }
        }
        let mut loras: Vec<String> = if generation.models.lora.enabled {
            generation
                .models
                .lora
                .loras
                .iter()
                .filter(|l| l.active)
                .map(|l| l.name.clone())
                .collect()
        } else {
            vec![]
        };
        let re = regex::Regex::new(r"(?i)<lora:([^:>]+)").unwrap();
        for w in [&state.positive, &state.negative] {
            loras.extend(re.captures_iter(&w.text).map(|c| c[1].to_string()));
        }
        if !loras.is_empty() {
            match if let Some((_, library)) = &self.link.network_cache {
                library.clone()
            } else {
                self.http("/prompt-editor/lora-library")
            } {
                Ok(library) => {
                    for name in loras {
                        let matches = library["files"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter(|file| lora_matches(&name, get(file, "key")))
                            .count();
                        if matches != 1 {
                            issues.push(issue(
                                "lora",
                                format!("LoRA 文件不存在或名称不唯一：{name}"),
                            ));
                        }
                    }
                }
                Err(error) => issues.push(issue("lora", error)),
            }
        }
        if self.link.runs.iter().any(|r| uncertain(&r.status)) {
            issues.push(issue(
                "unknown",
                "上次提交尚未确认；请先核对队列与历史，避免重复生成",
            ));
        }
        json!({"issues":issues,"page":page,"pages":live["pages"],"generation":generation,"state":state})
    }
    fn poll_runs(&mut self) -> Result<Value, String> {
        let live = self.link_status()?;
        let ids: HashSet<_> = self
            .link
            .runs
            .iter()
            .map(|r| r.request_id.clone())
            .collect();
        let missing = self.link.runs.iter().any(|r| {
            r.server_url == self.comfy_url
                && !terminal(&r.status)
                && !live["runs"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|v| v["request_id"] == r.request_id)
        });
        let (queue, history) = if missing {
            (
                link_get(&self.comfy_url, "/queue")?,
                link_get(&self.comfy_url, "/history")?,
            )
        } else {
            (Value::Null, Value::Null)
        };
        self.apply_poll(live, queue, history, &ids)
    }
    fn apply_poll(
        &mut self,
        live: Value,
        queue: Value,
        history: Value,
        ids: &HashSet<String>,
    ) -> Result<Value, String> {
        let old_link = self.link.clone();
        let before = serde_json::to_string(&self.link).unwrap();
        for run in &mut self.link.runs {
            if !ids.contains(&run.request_id)
                || run.server_url != self.comfy_url
                || terminal(&run.status)
            {
                continue;
            }
            if let Some(remote) = live["runs"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|r| r["request_id"] == run.request_id)
            {
                if let Some(status) = remote["status"].as_str() {
                    run.status = status.into();
                }
                if let Some(pid) = remote["prompt_id"].as_str() {
                    run.prompt_id = Some(pid.into());
                }
                run.error = remote["error"].as_str().map(str::to_string);
                run.execution_error = remote["execution_error"].clone();
                run.seed_used = remote["seed_used"] == true;
                run.outputs = remote["outputs"].as_array().cloned().unwrap_or_default();
            }
        }
        // A backend restart loses relay memory. Inspect authoritative metadata before deciding anything.
        let missing: Vec<_> = self
            .link
            .runs
            .iter()
            .enumerate()
            .filter(|(_, r)| {
                ids.contains(&r.request_id)
                    && r.server_url == self.comfy_url
                    && !terminal(&r.status)
                    && !live["runs"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|v| v["request_id"] == r.request_id)
            })
            .map(|(i, _)| i)
            .collect();
        if !missing.is_empty() {
            for index in missing {
                let run = &mut self.link.runs[index];
                let matches = |prompt: &Value| {
                    prompt[3]["extra_pnginfo"]["workflow"]["extra"]["prompt_editor_snapshots"]
                        .as_object()
                        .is_some_and(|s| {
                            s.values()
                                .any(|s| s["snapshot_id"] == run.snapshot["snapshot_id"])
                        })
                };
                let found = ["queue_running", "queue_pending"].iter().find_map(|key| {
                    queue[*key]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|p| matches(p))
                        .map(|p| ((*key).to_string(), p.clone()))
                });
                if let Some((key, prompt)) = found {
                    run.status = if key == "queue_running" {
                        "running"
                    } else {
                        "queued"
                    }
                    .into();
                    run.prompt_id = prompt[1].as_str().map(str::to_string);
                    run.seed_used = snapshot_used(&prompt, &run.snapshot["snapshot_id"]);
                    continue;
                }
                if let Some((pid, entry)) = history
                    .as_object()
                    .into_iter()
                    .flatten()
                    .find(|(_, e)| matches(&e["prompt"]))
                {
                    run.prompt_id = Some(pid.clone());
                    run.seed_used = snapshot_used(&entry["prompt"], &run.snapshot["snapshot_id"]);
                    if let Some(message) = entry["status"]["messages"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|m| m[0] == "execution_error" || m[0] == "execution_interrupted")
                    {
                        run.execution_error = message[1].clone();
                        run.error = message[1]["exception_message"].as_str().map(str::to_string);
                    }
                    run.status = if entry["status"]["messages"]
                        .as_array()
                        .is_some_and(|ms| ms.iter().any(|m| m[0] == "execution_interrupted"))
                    {
                        "cancelled"
                    } else if entry["status"]["status_str"] == "error" {
                        "failed"
                    } else {
                        "completed"
                    }
                    .into();
                    run.outputs =
                        entry["outputs"]
                            .as_object()
                            .into_iter()
                            .flatten()
                            .filter(|(node, _)| {
                                output_uses_snapshot(
                                    &entry["prompt"],
                                    &run.snapshot["snapshot_id"],
                                    node,
                                )
                            })
                            .flat_map(|(node, output)| {
                                output["images"].as_array().into_iter().flatten().map(
                                    move |image| {
                                        let mut image = image.clone();
                                        image["node_id"] = json!(node);
                                        image
                                    },
                                )
                            })
                            .collect();
                } else {
                    run.status = "unknown".into();
                    run.error =
                        Some("中继记录已丢失；队列与历史暂未找到此快照，禁止自动重提".into());
                }
            }
        }
        if before != serde_json::to_string(&self.link).unwrap() {
            if let Err(e) = self.persist("runs.json", &self.link) {
                self.link = old_link;
                return Err(e);
            }
        }
        let accepted: Vec<_> = self
            .link
            .runs
            .iter()
            .filter(|r| r.prompt_id.is_some() && r.seed_used && !r.seed_committed)
            .map(|r| get(&r.snapshot, "snapshot_id").to_string())
            .collect();
        for sid in accepted {
            self.link_commit(&sid)?;
        }
        Ok(json!({"runs":self.link.runs,"live":live,"probes":self.link.probes,"session_id":self.link.session}))
    }
    fn locked_input(&self, p: &Value) -> Result<Option<(EditingState, Generation)>, String> {
        if !get(p, "probe_id").is_empty() {
            let probe = self
                .link
                .probes
                .iter()
                .find(|v| v["id"] == p["probe_id"])
                .ok_or("探针不存在")?;
            return probe_variant(probe, p["variant_index"].as_u64().unwrap_or(0) as usize)
                .map(Some);
        }
        if !get(p, "source_request").is_empty() {
            let run = self
                .link
                .runs
                .iter()
                .find(|r| r.request_id == get(p, "source_request"))
                .ok_or("原生成快照不存在")?;
            let mut generation: Generation = parse_value(run.snapshot["generation"].clone())?;
            if p["random_seed"] == true {
                generation.seed = rand::random::<u64>() % MAX_SEED;
                if generation.seed == run.snapshot["generation"]["seed"].as_u64().unwrap_or(0) {
                    generation.seed = (generation.seed + 1) % MAX_SEED;
                }
            }
            generation.seed_control = "fixed".into();
            return Ok(Some((run.state.clone(), generation)));
        }
        Ok(None)
    }
    pub(super) fn link_rpc(&mut self, method: &str, p: Value) -> Result<Value, String> {
        match method {
            "runs.poll" => self.poll_runs(),
            "runs.list" => {
                Ok(json!({"runs":self.link.runs,"live":self.link.live,"probes":self.link.probes,"session_id":self.link.session}))
            }
            "runs.prompt" => {
                let run = self.link.runs.iter().find(|r| r.request_id == get(&p,"request_id")).ok_or("生成记录不存在")?;
                Ok(json!(editor::format_prompt(&run.state.positive)))
            }
            "runs.delete" => {
                if p["confirmed"] != true { return Err("请确认删除生成记录".into()); }
                let run = self.link.runs.iter().find(|r| r.request_id == get(&p,"request_id")).ok_or("生成记录不存在")?;
                if !matches!(run.status.as_str(), "completed" | "failed" | "cancelled" | "rejected") {
                    return Err("请等待任务结束并核对受理状态后再删除记录".into());
                }
                let mut next = self.link.clone();
                next.runs.retain(|r| r.request_id != get(&p,"request_id"));
                self.persist("runs.json", &next)?;
                self.link = next;
                Ok(json!({"runs":self.link.runs,"live":self.link.live}))
            }
            "runs.clear_inactive" => {
                let mut next = self.link.clone();
                let mut cleared = 0;
                for run in &mut next.runs {
                    let same_path = self.project_path.as_ref().zip(run.project_path.as_ref()).is_some_and(|(a,b)| a.replace('\\',"/").to_lowercase() == b.replace('\\',"/").to_lowercase());
                    let own = same_path || if let Some(project_id) = run.snapshot["project_id"].as_str() { project_id == self.editor.project.id } else { self.project_path.is_none() && run.project_path.is_none() && run.session_id == self.link.session };
                    if own && !run.film_hidden && matches!(run.status.as_str(), "cancelled" | "failed") {
                        run.film_hidden = true;
                        cleared += 1;
                    }
                }
                if cleared > 0 {
                    self.persist("runs.json", &next)?;
                    self.link = next;
                }
                Ok(json!({"runs":self.link.runs,"live":self.link.live,"cleared":cleared}))
            }
            "runs.probe.cancel" => {
                if p["confirmed"] != true {
                    return Err("请先确认探针取消范围".into());
                }
                let own: HashSet<_> = self
                    .link
                    .runs
                    .iter()
                    .filter(|r| r.probe.as_ref().is_some_and(|v| v["id"] == p["probe_id"]))
                    .filter_map(|r| r.prompt_id.as_ref())
                    .collect();
                let targets = ids(&p);
                if targets.iter().any(|pid| !own.contains(pid))
                    || (!get(&p, "prompt_id").is_empty()
                        && !own.contains(&get(&p, "prompt_id").to_string()))
                {
                    return Err("取消范围超出探针任务".into());
                }
                let mut request = p.clone();
                request["action"] = json!("cancel-probe");
                Self::link_post_at(&self.comfy_url, "/prompt-editor/queue-action", &request)
            }
            "runs.probe.prepare" => {
                if !self.generation.enabled {
                    return Err("先在生成参数页启用同步，以保证固定 Seed".into());
                }
                self.generation.validate()?;
                editor::validate(&mut self.editor.project.clone())?;
                let values = p["values"].as_array().ok_or("请输入扫描值")?;
                if values.is_empty() || values.len() > 16 {
                    return Err("探针需要 1–16 个扫描值".into());
                }
                let mut p = p.clone();
                if let Some(yvalues) = p["y_axis"]["values"].as_array().cloned() {
                    if yvalues.is_empty() || yvalues.len() * values.len() > 16 {
                        return Err("X/Y 组合须为 1–16 张".into());
                    }
                    if p["y_axis"]["target"] == p["target"]
                        && (p["y_axis"]["negative"] == true) == (p["negative"] == true)
                    {
                        return Err("X/Y 不能扫描同一个目标".into());
                    }
                    p["x_values"] = json!(values);
                    p["y_values"] = json!(yvalues
                        .iter()
                        .flat_map(|y| vec![y.clone(); values.len()])
                        .collect::<Vec<_>>());
                    p["values"] = json!(yvalues
                        .iter()
                        .flat_map(|_| values.clone())
                        .collect::<Vec<_>>());
                }
                let values = p["values"].as_array().unwrap();
                let check = self.link_preflight(&p);
                if check["issues"].as_array().is_some_and(|v| !v.is_empty()) {
                    return Err(format!("先处理体检问题：{}", check["issues"]));
                }
                let mut probe = json!({"id":id(),"created":chrono::Local::now().to_rfc3339(),"client_id":check["page"]["client_id"],"fingerprint":check["page"]["fingerprint"],"state":check["state"],"generation":check["generation"],"kind":p["kind"],"target":p["target"],"target_label":probe_target_label(&p,&check["state"]),"negative":p["negative"] == true,"values":values,"x_values":p["x_values"],"y_values":p["y_values"],"y_axis":if p["y_axis"].is_object(){let mut y=p["y_axis"].clone();y["target_label"]=json!(probe_target_label(&y,&check["state"]));y}else{Value::Null}});
                if !p["seed"].is_null() {
                    let seed = p["seed"].as_u64().filter(|s| *s <= MAX_SEED).ok_or("请输入有效的固定 Seed")?;
                    probe["generation"]["seed"] = json!(seed);
                }
                for i in 0..values.len() {
                    probe_variant(&probe, i)?;
                }
                let mut next = self.link.clone();
                next.probes.push(probe.clone());
                self.persist("runs.json", &next)?;
                self.link = next;
                Ok(probe)
            }
            "runs.probe.apply" => {
                let probe = self
                    .link
                    .probes
                    .iter()
                    .find(|v| v["id"] == p["probe_id"])
                    .ok_or("探针不存在")?;
                let i = p["variant_index"].as_u64().ok_or("请选择变体")? as usize;
                if !self.link.runs.iter().any(|r| {
                    r.probe
                        .as_ref()
                        .is_some_and(|v| v["id"] == p["probe_id"] && v["index"] == i)
                        && r.status == "completed"
                        && !r.outputs.is_empty()
                }) {
                    return Err("该变体尚无已完成结果，不能应用".into());
                }
                if get(&p, "revision") != serde_json::to_string(&json!([self.editor.project,self.generation])).unwrap()
                {
                    return Err("提示词已变化，请重新确认应用范围".into());
                }
                let mut scope = probe.clone();
                scope["state"] = serde_json::to_value(&self.editor.project.state).unwrap();
                scope["generation"] = serde_json::to_value(&self.generation).unwrap();
                let (state, generation) = probe_variant(&scope, i)?;
                let old = self.editor.clone();
                let old_generation = self.generation.clone();
                self.editor.transact(|e| {
                    e.project.state = state;
                    Ok(())
                })?;
                if generation != old_generation {
                    self.editor
                        .attach_generation(old_generation.clone(), generation.clone());
                    self.generation = generation;
                }
                let result = if self.generation != old_generation {
                    self.persist_adoption()
                } else {
                    self.persist("session.json", &self.editor.project)
                };
                if let Err(e) = result {
                    self.editor = old;
                    self.generation = old_generation;
                    return Err(e);
                }
                Ok(self.state())
            }
            "runs.preflight" => Ok(self.link_preflight(&p)),
            "runs.map" => {
                let name = get(&p, "name").to_string();
                let target = get(&p, "target").to_string();
                let old = self.editor.clone();
                self.editor.transact(|e| {
                    e.project.comfy_group_targets.insert(name, target);
                    Ok(())
                })?;
                if let Err(error) = self.persist("session.json", &self.editor.project) {
                    self.editor = old;
                    return Err(error);
                }
                Ok(self.state())
            }
            "runs.submit" => {
                let mut preflight_payload = p.clone();
                if let Some(first) = p["indices"].as_array().and_then(|v| v.first()) {
                    preflight_payload["variant_index"] = first.clone();
                }
                let check = self.link_preflight(&preflight_payload);
                if !check["issues"].as_array().is_some_and(Vec::is_empty) {
                    return Ok(json!({"preflight":check}));
                }
                let variant_indices: Vec<usize> = if !get(&p, "probe_id").is_empty() {
                    p["indices"]
                        .as_array()
                        .ok_or("请选择探针变体")?
                        .iter()
                        .map(|v| v.as_u64().map(|n| n as usize).ok_or("变体索引无效"))
                        .collect::<Result<_, _>>()?
                } else {
                    vec![]
                };
                if !variant_indices.is_empty() {
                    let mut unique = HashSet::new();
                    for i in &variant_indices {
                        if !unique.insert(*i) {
                            return Err("变体不能重复选择".into());
                        }
                        if let Some(last) = self.link.runs.iter().rev().find(|r| {
                            r.probe
                                .as_ref()
                                .is_some_and(|v| v["id"] == p["probe_id"] && v["index"] == *i)
                        }) {
                            if !matches!(last.status.as_str(), "failed" | "cancelled" | "rejected")
                            {
                                return Err(
                                    "该探针变体已完成、正在执行或受理待核对，不能重复提交".into()
                                );
                            }
                        }
                        let mut v = p.clone();
                        v["variant_index"] = json!(i);
                        self.locked_input(&v)?;
                    }
                }
                let count = if !get(&p, "probe_id").is_empty() {
                    variant_indices.len() as u64
                } else {
                    p["count"].as_u64().unwrap_or(1)
                };
                if !(1..=16).contains(&count) {
                    return Err("一次可提交 1–16 张任务".into());
                }
                let mut state: EditingState = parse_value(check["state"].clone())?;
                let mut generation: Generation = parse_value(check["generation"].clone())?;
                if p["lock_seed"] == true {
                    generation.seed_control = "fixed".into();
                }
                let mut added = vec![];
                let mut seed_before = self.generation.clone();
                for n in 0..count {
                    let variant_index = variant_indices.get(n as usize).copied().unwrap_or(0);
                    if !variant_indices.is_empty() {
                        let mut v = p.clone();
                        v["variant_index"] = json!(variant_index);
                        let (vs, vg) = self.locked_input(&v)?.ok_or("探针基线不存在")?;
                        state = vs;
                        generation = vg;
                        generation.groups = parse_value(check["generation"]["groups"].clone())?;
                    }
                    let sid = id();
                    let targets = if get(&p,"source_request").is_empty() { json!(self.editor.project.comfy_group_targets) } else { self.link.runs.iter().find(|r| r.request_id == get(&p,"source_request")).map(|r| r.snapshot["comfy_group_targets"].clone()).unwrap_or(json!({})) };
                    let snapshot = json!({"protocol_version":2,"snapshot_id":sid,"positive":editor::format_prompt(&state.positive),"negative":editor::format_prompt(&state.negative),"generation":generation,"comfy_group_targets":targets,"project_id":self.editor.project.id});
                    // Preserve existing commit comparison; never overwrite edits made after capture.
                    self.snapshots
                        .insert(sid.clone(), serde_json::to_string(&generation).unwrap());
                    generation.advance_seed();
                    let mut seed_after = seed_before.clone();
                    if seed_before.enabled
                        && p["lock_seed"] != true
                        && variant_indices.is_empty()
                        && get(&p, "source_request").is_empty()
                    {
                        // Use the precomputed next seed, including random batches; never randomize twice.
                        seed_after.seed = generation.seed;
                    }
                    added.push(Run {
                        request_id: id(),
                        session_id: self.link.session.clone(),
                        project_path: self.project_path.clone(),
                        probe: if get(&p,"probe_id").is_empty() { None } else { Some(json!({"id":p["probe_id"],"index":variant_index,"value":self.link.probes.iter().find(|v|v["id"]==p["probe_id"]).unwrap()["values"][variant_index],"target":self.link.probes.iter().find(|v|v["id"]==p["probe_id"]).unwrap()["target"],"kind":self.link.probes.iter().find(|v|v["id"]==p["probe_id"]).unwrap()["kind"]})) },
                        server_url: self.comfy_url.clone(),
                        client_id: get(&check["page"], "client_id").into(),
                        fingerprint: get(&check["page"], "fingerprint").into(),
                        created: chrono::Local::now().to_rfc3339(),
                        snapshot,
                        state: state.clone(),
                        status: "dispatching".into(),
                        prompt_id: None,
                        outputs: vec![],
                        error: None,
                        execution_error: Value::Null,
                        seed_before: Some(seed_before.clone()),
                        seed_after: Some(seed_after.clone()),
                        seed_committed: false,
                        seed_used: false,
                        film_hidden: false,
                        feedback_seen: false,
                    });
                    seed_before = seed_after;
                }
                // All variants are durably captured before the first network operation.
                let mut next = self.link.clone();
                next.runs.extend(added.clone());
                self.persist("runs.json", &next)?;
                self.link = next;
                if self.link.defer_dispatch {
                    return Ok(
                        json!({"runs":self.link.runs,"live":self.link.live,"probes":self.link.probes}),
                    );
                }
                for (index, run) in added.iter().enumerate() {
                    let result = Self::link_post_at(
                        &run.server_url,
                        "/prompt-editor/run",
                        &json!({"request_id":run.request_id,"snapshot":run.snapshot,"client_id":run.client_id,"fingerprint":run.fingerprint,"editor_url":format!("http://127.0.0.1:{}", self.bridge_port)}),
                    );
                    if let Err(error) = result {
                        if let Some(r) = self
                            .link
                            .runs
                            .iter_mut()
                            .find(|r| r.request_id == run.request_id)
                        {
                            r.status = if error.starts_with("已拒绝：") {
                                "rejected"
                            } else {
                                "unknown"
                            }
                            .into();
                            r.error = Some(format!("{error}；先核对队列与历史"));
                        }
                        for remaining in &added[index + 1..] {
                            if let Some(r) = self
                                .link
                                .runs
                                .iter_mut()
                                .find(|r| r.request_id == remaining.request_id)
                            {
                                r.status = "rejected".into();
                                r.error = Some("前序请求未确认，本任务尚未发送".into());
                            }
                        }
                        self.persist("runs.json", &self.link)?;
                        break;
                    }
                }
                Ok(json!({"runs":self.link.runs,"live":self.link.live,"probes":self.link.probes}))
            }
            "runs.queue" => {
                if p["confirmed"] != true {
                    return Err("请确认受影响任务后再操作".into());
                }
                Self::link_post_at(&self.comfy_url, "/prompt-editor/queue-action", &p)
            }
            "runs.diff" | "runs.apply" => {
                let run = self
                    .link
                    .runs
                    .iter()
                    .find(|r| r.request_id == get(&p, "request_id"))
                    .ok_or("生成记录不存在")?;
                let target_generation: Generation = parse_value(run.snapshot["generation"].clone())?;
                let mut rows = differences(&self.editor.project.state, &run.state);
                rows.extend(crate::parameter_diff::rows(&self.generation, &target_generation));
                if run.snapshot["comfy_group_targets"].is_object() && json!(self.editor.project.comfy_group_targets) != run.snapshot["comfy_group_targets"] {
                    rows.push(json!({"id":"workflow/targets","side":"parameters","label":"工作流分组映射","from":json!(self.editor.project.comfy_group_targets).to_string(),"to":run.snapshot["comfy_group_targets"].to_string()}));
                }
                let revision = serde_json::to_string(&json!([self.editor.project,self.generation])).unwrap();
                if method == "runs.diff" {
                    return Ok(json!({"rows":rows,"revision":revision}));
                }
                if get(&p, "revision") != revision {
                    return Err("提示词已改变，请重新预览差异后应用".into());
                }
                let mut project = self.editor.project.clone();
                if p["full"] == true {
                    project.state = run.state.clone();
                    project.state.is_negative = self.editor.project.state.is_negative;
                    if run.snapshot["comfy_group_targets"].is_object() {
                        project.comfy_group_targets = parse_value(run.snapshot["comfy_group_targets"].clone())?;
                    }
                } else {
                    let selected = ids(&p);
                    if selected.is_empty()
                        || selected
                            .iter()
                            .any(|id| !rows.iter().any(|r| get(r, "id") == id))
                    {
                        return Err("请选择有效差异".into());
                    }
                    project.state.positive = merge_workspace(
                        &project.state.positive,
                        &run.state.positive,
                        "positive",
                        &selected,
                    )?;
                    project.state.negative = merge_workspace(
                        &project.state.negative,
                        &run.state.negative,
                        "negative",
                        &selected,
                    )?;
                    if selected.iter().any(|id| id == "workflow/targets") {
                        project.comfy_group_targets = parse_value(run.snapshot["comfy_group_targets"].clone())?;
                    }
                }
                // Validation normalizes parser caches in both workspaces. Validate a copy so
                // untouched sides and the captured full version remain byte-for-byte intact.
                editor::validate(&mut project.clone())?;
                let adopt_generation: Option<Generation> = if p["full"] == true {
                    let g = target_generation;
                    g.validate()?;
                    Some(g)
                } else {
                    Some(crate::parameter_diff::merge(&self.generation, &target_generation, &ids(&p))?)
                };
                if p["save_snapshot"] == true {
                    let name = get(&p,"snapshot_name").trim();
                    if name.is_empty() { return Err("快照名称不能为空".into()); }
                    project.snapshots.push(crate::model::Snapshot { id:id(),name:name.into(),created:chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),state:self.editor.project.state.clone(),generation:Some(self.generation.clone()),comfy_group_targets:Some(self.editor.project.comfy_group_targets.clone()) });
                }
                let old = self.editor.clone();
                let old_generation = self.generation.clone();
                self.editor.transact(|e| {
                    e.project = project;
                    Ok(())
                })?;
                let result = if let Some(g) = adopt_generation {
                    self.editor
                        .attach_generation(old_generation.clone(), g.clone());
                    self.generation = g;
                    self.persist_adoption()
                } else {
                    self.persist("session.json", &self.editor.project)
                };
                if let Err(error) = result {
                    self.editor = old;
                    self.generation = old_generation;
                    return Err(error);
                }
                Ok(self.state())
            }
            "runs.image" => {
                let run = self
                    .link
                    .runs
                    .iter()
                    .find(|r| r.request_id == get(&p, "request_id"))
                    .ok_or("生成记录不存在")?;
                load_image(run, &p)
            }
            _ => Err(format!("未知联动命令：{method}")),
        }
    }
    pub(super) fn link_commit(&mut self, sid: &str) -> Result<Option<bool>, String> {
        let Some(index) = self
            .link
            .runs
            .iter()
            .position(|r| get(&r.snapshot, "snapshot_id") == sid)
        else {
            return Ok(None);
        };
        let run = &self.link.runs[index];
        if run.seed_committed {
            return Ok(Some(false));
        }
        let mut changed = false;
        if self.generation_problem().is_none() && run.seed_before.as_ref() == Some(&self.generation)
        {
            if let Some(next) = run.seed_after.clone() {
                self.persist("generation.json", &next)?;
                changed = self.generation.seed != next.seed;
                self.generation = next;
            }
        }
        self.link.runs[index].seed_committed = true;
        self.persist("runs.json", &self.link)?;
        self.snapshots.remove(sid);
        if let Some(ui) = &self.ui {
            let _ = ui("bridge-state-changed", Value::Null);
        }
        Ok(Some(changed))
    }
}

fn image_file(run: &Run, p: &Value) -> Result<Value, String> {
    let output = run
        .outputs
        .get(p["index"].as_u64().unwrap_or(0) as usize)
        .ok_or("输出图片不存在")?;
    let mut url = reqwest::Url::parse(&format!(
        "{}/prompt-editor/image-path",
        AppState::validate_comfy_url(&run.server_url)?
    ))
    .map_err(|e| e.to_string())?;
    for key in ["filename", "subfolder", "type"] {
        url.query_pairs_mut().append_pair(key, get(output, key));
    }
    let value = link_get(
        &run.server_url,
        &format!("/prompt-editor/image-path?{}", url.query().unwrap_or("")),
    )
    .map_err(|e| format!("无法读取图片路径，请确认图片存在并已更新 Bridge：{e}"))?;
    let path = std::path::PathBuf::from(value["path"].as_str().ok_or("Bridge 未返回图片路径")?);
    if !path.is_absolute() || !path.is_file() {
        return Err("图片不在本机或已删除；请在运行 ComfyUI 的电脑上操作".into());
    }
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ![
        "png", "jpg", "jpeg", "webp", "bmp", "gif", "avif", "tif", "tiff",
    ]
    .contains(&extension.as_str())
    {
        return Err("不是支持的图片文件".into());
    }
    Ok(json!({"path":path.to_string_lossy()}))
}
fn load_image(run: &Run, p: &Value) -> Result<Value, String> {
    let output = run
        .outputs
        .get(p["index"].as_u64().unwrap_or(0) as usize)
        .ok_or("输出图片不存在")?;
    let mut url = reqwest::Url::parse(&format!(
        "{}/view",
        AppState::validate_comfy_url(&run.server_url)?
    ))
    .map_err(|e| e.to_string())?;
    for key in ["filename", "subfolder", "type"] {
        url.query_pairs_mut().append_pair(key, get(output, key));
    }
    let response = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut bytes = vec![];
    response
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("图片超过预览大小限制，请在 ComfyUI 中查看原图".into());
    }
    let mut image = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    if p["full"] != true {
        image = image.thumbnail(256, 256);
    }
    let mut png = std::io::Cursor::new(vec![]);
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(json!(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png.into_inner())
    )))
}

fn probe_variant(probe: &Value, index: usize) -> Result<(EditingState, Generation), String> {
    let mut state: EditingState = parse_value(probe["state"].clone())?;
    let mut generation: Generation = parse_value(probe["generation"].clone())?;
    let value = probe["values"]
        .get(index)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && (-10.0..=10.0).contains(v))
        .ok_or("扫描值须在 -10 到 10 之间")?;
    generation.seed_control = "fixed".into();
    match get(probe, "kind") {
        "lora" => {
            if !generation.models.lora.enabled || generation.models.lora.node_id.is_empty() {
                return Err("请先配置并启用 LoRA 控制器".into());
            }
            let entry = generation
                .models
                .lora
                .loras
                .iter_mut()
                .find(|l| l.name == get(probe, "target"))
                .ok_or("目标 LoRA 已移除，请重新配置")?;
            entry.strength = parser::number(&value.to_string()).ok_or("扫描值无效")?;
            entry.clip_strength = entry.strength;
            entry.active = true;
        }
        "weight" | "presence" => {
            let mut e = Editor::default();
            e.project.state = state;
            let previous = e.project.state.is_negative;
            e.project.state.is_negative = probe["negative"] == true;
            let target = get(probe, "target").to_string();
            if get(probe, "kind") == "presence" {
                if value != 0.0 && value != 1.0 {
                    return Err("有无探针只支持 0 和 1".into());
                }
                if value == 0.0 {
                    e.hide(&[target])?;
                } else if !e.current().active.iter().any(|t| t.id == target) {
                    e.restore(&[target])?;
                }
            } else {
                e.weight(
                    &[target],
                    Some(parser::number(&value.to_string()).ok_or("扫描值无效")?),
                    false,
                )?;
            }
            e.project.state.is_negative = previous;
            state = e.project.state;
        }
        _ => return Err("不支持的探针变量".into()),
    }
    generation.validate()?;
    if probe["y_axis"].is_object() {
        let mut y = probe["y_axis"].clone();
        y["state"] = serde_json::to_value(&state).unwrap();
        y["generation"] = serde_json::to_value(&generation).unwrap();
        y["values"] = json!([probe["y_values"][index]]);
        return probe_variant(&y, 0);
    }
    Ok((state, generation))
}

impl LinkStore {
    pub(super) fn initialize_feedback(&mut self) {
        if self.session.is_empty() {
            self.session = id();
        }
        for r in &mut self.runs {
            if terminal(&r.status) {
                r.feedback_seen = true;
            }
        }
    }
}
pub(super) fn feedback_shared(shared: &Shared, app: tauri::AppHandle) -> Result<Value, String> {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    let window = app.get_webview_window("main").ok_or("原生窗口不可用")?;
    let focused = window.is_focused().unwrap_or(true);
    let (completed, enabled, directory, progress, has_active, failed, cancelled) = {
        let mut state = shared.lock().map_err(|_| "编辑器状态不可用")?;
        let mut next = state.link.clone();
        let terminal_runs: Vec<_> = next
            .runs
            .iter()
            .filter(|r| terminal(&r.status) && !r.feedback_seen)
            .cloned()
            .collect();
        for run in &mut next.runs {
            if terminal(&run.status) {
                run.feedback_seen = true;
            }
        }
        if !terminal_runs.is_empty() {
            state.persist("runs.json", &next)?;
            state.link = next;
        }
        let active = state
            .link
            .runs
            .iter()
            .any(|r| r.server_url == state.comfy_url && !terminal(&r.status));
        let progress = state.link.live["runs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|r| r["status"] == "running")
            .find_map(|r| {
                let max = r["progress"]["max"].as_f64()?;
                let value = r["progress"]["value"].as_f64()?;
                if max > 0.0 {
                    Some(((value / max * 100.0).clamp(0.0, 100.0)) as u64)
                } else {
                    None
                }
            });
        let failed = terminal_runs.iter().any(|r| r.status == "failed");
        let cancelled = terminal_runs.iter().any(|r| r.status == "cancelled");
        (
            terminal_runs,
            state.settings.generation_notifications,
            state.directory.clone(),
            progress,
            active,
            failed,
            cancelled,
        )
    };
    let status = if has_active {
        if progress.is_some() {
            ProgressBarStatus::Normal
        } else {
            ProgressBarStatus::Indeterminate
        }
    } else if !focused && failed {
        ProgressBarStatus::Error
    } else if !focused && cancelled {
        ProgressBarStatus::Paused
    } else {
        ProgressBarStatus::None
    };
    let progress_error = window
        .set_progress_bar(ProgressBarState {
            status: Some(status),
            progress: Some(progress.unwrap_or(if failed || cancelled { 100 } else { 0 })),
        })
        .err()
        .map(|e| e.to_string());
    let mut notification_error: Option<String> = None;
    if enabled && !focused {
        for run in completed
            .into_iter()
            .filter(|r| r.status == "completed" && !r.outputs.is_empty())
        {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                use tauri_winrt_notification::Toast;
                let app_id = "local.memo.prompt-editor-tauri";
                // Register only this opt-in application's notification identity for the portable EXE.
                let registered = std::process::Command::new("reg.exe")
                    .args([
                        "add",
                        r"HKCU\Software\Classes\AppUserModelId\local.memo.prompt-editor-tauri",
                        "/v",
                        "DisplayName",
                        "/t",
                        "REG_SZ",
                        "/d",
                        "Prompt Editor",
                        "/f",
                    ])
                    .creation_flags(0x08000000)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if !registered {
                    notification_error =
                        Some("无法注册 Windows 通知标识；结果已保留在生成记录".into());
                    continue;
                }
                let run_id = run.request_id.clone();
                let handle = app.clone();
                let used = std::sync::atomic::AtomicBool::new(false);
                let toast=Toast::new(app_id).title("生成完成").text1(&format!("Seed {} · {} 张结果",run.snapshot["generation"]["seed"],run.outputs.len())).add_button("查看","view").add_button("再来一张","again").on_activated(move |action|{
                    if used.swap(true,std::sync::atomic::Ordering::SeqCst) {return Ok(());}
                    if let Some(w)=handle.get_webview_window("main") {let _=w.show();let _=w.unminimize();let _=w.set_focus();}
                    let _=handle.emit("generation-notification-action",json!({"request_id":run_id,"action":action.unwrap_or_else(||"view".into())}));Ok(())
                });
                let cache = directory.join("notification-cache");
                let thumbnail = (|| -> Result<PathBuf, String> {
                    storage::ensure_dir(&cache)?;
                    let mut files: Vec<_> = std::fs::read_dir(&cache)
                        .map_err(|e| e.to_string())?
                        .filter_map(Result::ok)
                        .filter(|e| e.file_name().to_string_lossy().ends_with(".png"))
                        .collect();
                    files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
                    let count = files.len().saturating_sub(15);
                    for f in files.into_iter().take(count) {
                        let _ = std::fs::remove_file(f.path());
                    }
                    let data = load_image(&run, &json!({"index":0}))?;
                    let encoded = data
                        .as_str()
                        .and_then(|v| v.split_once(','))
                        .ok_or("缩略图不可用")?
                        .1;
                    let path = cache.join(format!("{}.png", run.request_id));
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|e| e.to_string())?;
                    storage::atomic_bytes(&path, &bytes)?;
                    Ok(path)
                })()
                .ok();
                // Focus can change while the thumbnail is being read.
                if window.is_focused().unwrap_or(true) {
                    continue;
                }
                let toast = if let Some(path) = thumbnail {
                    toast.image(&path, "生成结果")
                } else {
                    toast
                };
                if let Err(e) = toast.show() {
                    notification_error =
                        Some(format!("Windows 通知不可用：{e}；结果已保留在生成记录"));
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = (&run, &directory);
                notification_error = Some("此平台不支持 Windows 通知，结果已保留在生成记录".into());
            }
        }
    }
    Ok(json!({"notification_error":notification_error,"progress_error":progress_error}))
}

fn probe_target_label(probe: &Value, state: &Value) -> String {
    if get(probe, "kind") == "lora" {
        return get(probe, "target").into();
    }
    let side = if probe["negative"] == true {
        "Negative"
    } else {
        "Positive"
    };
    state[side]["Active"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|t| t["Id"] == probe["target"])
        .and_then(|t| t["Base"].as_str())
        .unwrap_or(get(probe, "target"))
        .into()
}
