use crate::model::*;
use regex::Regex;
use rust_decimal::Decimal;
use serde::Serialize;
use std::{str::FromStr, sync::LazyLock};
use unicode_normalization::UnicodeNormalization;
static FACE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:[:;=][\-^]?[()dDpPoO3/\\]|[oO><][_.][oO><]|[><]_[><])").unwrap()
});
static NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$").unwrap());
static LORA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^<\s*(?:lora|lyco|lycoris)\s*:").unwrap());
static LEGACY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"([^\s]):\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$").unwrap());
static SENTENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:she|he|they|it|there|this|these)\s+(?:is|are|was|were|has|have|stands?|sits?|looks?|wears?)\b").unwrap()
});
static START: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:a|an|the|she|he|they|her|his|their|there|this|these|in|on|with|at|behind|under|two|three|an? anime[ -]style)\b").unwrap()
});
static VERB: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:is|are|was|were|has|have|stands?|sits?|looks?|wears?|walks?|casts?|blends?|features?|depicts?|focuses?|holds?|rests?|lies?|shows?|creates?|gives?|appears?|surrounds?|illuminates?)\b").unwrap()
});
static NOUN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:an?|the)\b.*\b(?:illustration|painting|portrait|wallpaper|photograph|composition|scene)\b").unwrap()
});
static PUNCTUATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*([,;:])\s*").unwrap());
static UNESCAPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\([()\[\],:;\\])").unwrap());
fn face(s: &str) -> bool {
    FACE.find(s)
        .is_some_and(|m| m.start() == 0 && m.end() == s.len())
}
pub fn number(s: &str) -> Option<Decimal> {
    let t = s.trim();
    if NUMBER.is_match(t) {
        Decimal::from_str(t).ok()
    } else {
        None
    }
}
pub fn normalize(s: &str) -> String {
    let s = s
        .nfkc()
        .collect::<String>()
        .trim()
        .to_lowercase()
        .replace('ß', "ss");
    if face(&s) {
        return s;
    }
    let mut c: Vec<char> = s.replace('_', " ").chars().collect();
    for i in 1..c.len().saturating_sub(1) {
        if "-‐‑–—".contains(c[i]) && c[i - 1].is_alphanumeric() && c[i + 1].is_alphanumeric()
        {
            c[i] = ' '
        }
    }
    let s = c
        .iter()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    PUNCTUATION
        .replace_all(&s, "$1 ")
        .trim_matches(|c| " ,;.!?，；。！？".contains(c))
        .to_string()
}
fn unescape(s: &str) -> String {
    UNESCAPE.replace_all(s, "$1").into_owned()
}
fn sentence(s: &str) -> bool {
    let n = s.split_whitespace().count();
    SENTENCE.is_match(s)
        || n >= 14
        || s.chars().count() > 120
        || n >= 5 && START.is_match(s) && (VERB.is_match(s) || NOUN.is_match(s))
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ParseResult {
    pub terms: Vec<Term>,
    pub error: Option<String>,
    pub error_offset: usize,
    pub valid: bool,
}
struct Scanner {
    chars: Vec<char>,
    offsets: Vec<usize>,
    protected: Vec<bool>,
    result: ParseResult,
}
impl Scanner {
    fn text(&self, a: usize, b: usize) -> String {
        self.chars[a..b].iter().collect()
    }
    fn utf16(&self, at: usize) -> usize {
        self.offsets[at]
    }
    fn error(&mut self, at: usize, msg: &str) {
        if self.result.error.is_none() {
            let offset = self.utf16(at);
            self.result.error = Some(format!("{}（位置 {}）", msg, offset + 1));
            self.result.error_offset = offset;
            self.result.valid = false;
        }
    }
    fn term(
        &self,
        a: usize,
        b: usize,
        base: String,
        kind: &str,
        weight: Decimal,
        weighted: bool,
        group: Option<String>,
        editable: bool,
        bs: usize,
        bl: usize,
    ) -> Term {
        Term {
            id: id(),
            raw: self.text(a, b),
            base: base.clone(),
            key: if kind == "normal" {
                normalize(&unescape(&base))
            } else {
                String::new()
            },
            kind: kind.into(),
            weight,
            weighted,
            editable,
            start: self.utf16(a),
            length: self.utf16(b) - self.utf16(a),
            base_start: self.utf16(bs),
            base_length: bl,
            group,
            previous: None,
            next: None,
        }
    }
    fn close(&mut self, at: usize, end: usize) -> Option<usize> {
        let mut stack = vec![];
        let mut i = at;
        while i < end {
            let c = self.chars[i];
            if c == '\\' {
                i += 2;
                continue;
            }
            if self.protected[i] {
                i += 1;
                continue;
            }
            if "([{".contains(c) {
                stack.push(c)
            } else if ")]}".contains(c) {
                let Some(open) = stack.pop() else { return None };
                if !matches!((open, c), ('(', ')') | ('[', ']') | ('{', '}')) {
                    self.error(i, "括号不匹配");
                    return None;
                }
                if stack.is_empty() {
                    return Some(i);
                }
            }
            i += 1
        }
        self.error(at, "括号未闭合");
        None
    }
    fn add(
        &mut self,
        mut a: usize,
        mut b: usize,
        factor: Decimal,
        mut weighted: bool,
        group: Option<String>,
        editable: bool,
    ) {
        while a < b && self.chars[a].is_whitespace() {
            a += 1
        }
        while b > a && self.chars[b - 1].is_whitespace() {
            b -= 1
        }
        if a >= b {
            return;
        }
        let raw = self.text(a, b);
        if raw.trim_matches(|c| " ,;，；".contains(c)).is_empty() {
            return;
        }
        let mut base = raw.clone();
        let mut own = Decimal::ONE;
        if let Some(cap) = LEGACY.captures(&raw) {
            if let Some(w) = number(&cap[2]) {
                own = w;
                let cut = cap.get(1).unwrap().end();
                base = raw[..cut].to_string();
                weighted = true
            }
        }
        base = base.trim().to_string();
        if !face(&base) {
            base = base.trim_matches(|c| " ,;.!?，；。！？".contains(c)).into()
        }
        if base.is_empty() {
            return;
        }
        let special = ["BREAK", "AND", "ADDCOMM", "ADDBASE"].contains(&base.as_str())
            || !base.chars().any(char::is_alphanumeric) && !face(&base);
        let Some(weight) = factor.checked_mul(own) else {
            self.error(a, "嵌套权重超出支持的十进制范围");
            return;
        };
        let bl = base.encode_utf16().count();
        let base_offset = raw.find(&base).map_or(0, |offset| raw[..offset].chars().count());
        let t = self.term(
            a,
            b,
            base,
            if special { "special" } else { "normal" },
            weight,
            weighted,
            group,
            editable && !special,
            a + base_offset,
            bl,
        );
        self.result.terms.push(t);
    }
    fn scan(
        &mut self,
        begin: usize,
        end: usize,
        factor: Decimal,
        weighted: bool,
        group: Option<String>,
        editable: bool,
        nesting: usize,
    ) {
        if nesting > 100 {
            self.error(begin, "括号嵌套超过 100 层，请简化语法");
            return;
        }
        let mut seg = begin;
        let mut is_sentence = false;
        let mut i = begin;
        while i < end {
            let c = self.chars[i];
            if c == '\\' {
                i += 2;
                continue;
            }
            if self.protected[i] {
                i += 1;
                continue;
            }
            if c == '<'
                && i + 1 < end
                && (self.chars[i + 1].is_alphabetic() || self.chars[i + 1].is_whitespace())
            {
                self.add(seg, i, factor, weighted, group.clone(), editable);
                let Some(close) = (i + 1..end).find(|p| self.chars[*p] == '>') else {
                    self.error(i, "声明未闭合");
                    return;
                };
                let raw = self.text(i, close + 1);
                let kind = if LORA.is_match(&raw) {
                    "lora"
                } else {
                    "special"
                };
                let mut t = self.term(
                    i,
                    close + 1,
                    raw.clone(),
                    kind,
                    Decimal::ONE,
                    false,
                    None,
                    false,
                    i,
                    raw.encode_utf16().count(),
                );
                let parts = raw[..raw.len() - 1].rsplit_once(':');
                if kind == "lora" {
                    if let Some((_, s)) = parts {
                        if let Some(w) = number(s) {
                            if raw.matches(':').count() == 2 {
                                t.editable = true;
                                t.weight = w;
                                t.weighted = true
                            }
                        }
                    }
                    if !t.editable && raw.matches(':').count() == 2 {
                        self.error(i, "LoRA 权重必须是有限十进制数");
                        return;
                    }
                }
                self.result.terms.push(t);
                i = close + 1;
                seg = i;
                continue;
            }
            if "([{".contains(c) {
                let Some(close) = self.close(i, end) else {
                    return;
                };
                self.add(seg, i, factor, weighted, group.clone(), editable);
                let inner = self.text(i + 1, close);
                let mut colons = vec![];
                let mut depth = 0;
                let mut k = i + 1;
                while k < close {
                    if self.chars[k] == '\\' {
                        k += 2;
                        continue;
                    }
                    if !self.protected[k] {
                        match self.chars[k] {
                            '(' | '[' | '{' => depth += 1,
                            ')' | ']' | '}' => depth -= 1,
                            ':' if depth == 0 => colons.push(k),
                            _ => (),
                        }
                    }
                    k += 1
                }
                if c != '(' || inner.contains('|') || colons.len() > 1 {
                    let raw = self.text(i, close + 1);
                    let basis = if c == '[' { inner.clone() } else { raw };
                    let normal = c == '[' && !inner.contains(':') && !inner.contains('|');
                    let mut t = self.term(
                        i,
                        close + 1,
                        basis.clone(),
                        if normal { "normal" } else { "special" },
                        Decimal::ONE,
                        false,
                        None,
                        false,
                        i + 1,
                        inner.encode_utf16().count(),
                    );
                    t.key = normalize(&unescape(&basis));
                    self.result.terms.push(t)
                } else {
                    let mut own = Decimal::new(11, 1);
                    let mut inner_end = close;
                    if let Some(colon) = colons.first() {
                        let Some(n) = number(&self.text(colon + 1, close)) else {
                            self.error(*colon, "权重必须是有限十进制数");
                            return;
                        };
                        own = n;
                        inner_end = *colon
                    }
                    let Some(next) = factor.checked_mul(own) else {
                        self.error(i, "嵌套权重超出支持的十进制范围");
                        return;
                    };
                    let start = self.result.terms.len();
                    self.scan(
                        i + 1,
                        inner_end,
                        next,
                        true,
                        group.clone().or(Some(format!("g{}", self.utf16(i)))),
                        editable,
                        nesting + 1,
                    );
                    if self.result.valid
                        && self.result.terms[start..]
                            .iter()
                            .any(|t| t.kind != "normal" || !t.editable)
                    {
                        self.result.terms.truncate(start);
                        let raw = self.text(i, close + 1);
                        let t = self.term(
                            i,
                            close + 1,
                            raw.clone(),
                            "special",
                            Decimal::ONE,
                            false,
                            None,
                            false,
                            i,
                            raw.encode_utf16().count(),
                        );
                        self.result.terms.push(t)
                    }
                }
                i = close + 1;
                seg = i;
                is_sentence = false;
                continue;
            }
            if ")]}".contains(c) {
                self.error(i, "多余的右括号");
                return;
            }
            let boundary = ".!?。！？".contains(c)
                && i + 1 < end
                && (self.chars[i + 1].is_whitespace() || self.chars[i + 1].is_ascii_uppercase());
            if ",，;；".contains(c) {
                if !is_sentence {
                    is_sentence = sentence(self.text(seg, i).trim())
                }
                if !is_sentence {
                    self.add(seg, i, factor, weighted, group.clone(), editable);
                    seg = i + 1
                }
            } else if c == '\n' || c == '\r' || boundary {
                self.add(
                    seg,
                    if boundary { i + 1 } else { i },
                    factor,
                    weighted,
                    group.clone(),
                    editable,
                );
                seg = i + 1;
                is_sentence = false
            }
            i += 1
        }
        self.add(seg, end, factor, weighted, group, editable);
    }
}
pub fn parse(s: &str, previous: Option<&[Term]>) -> ParseResult {
    parse_source(s, &[], previous)
}

pub fn parse_source(s: &str, natural: &[SourceRange], previous: Option<&[Term]>) -> ParseResult {
    let Some(ranges) = natural_bytes(s, natural) else {
        return ParseResult {
            terms: vec![],
            error: Some("自然语言范围无效".into()),
            error_offset: 0,
            valid: false,
        };
    };
    let mut result = ParseResult {
        terms: vec![],
        error: None,
        error_offset: 0,
        valid: true,
    };
    let mut byte = 0;
    let mut offset = 0;
    for (range, bytes) in natural.iter().zip(ranges) {
        append_source(&mut result, &s[byte..bytes.start], offset);
        byte = bytes.end;
        let raw = s[bytes].to_string();
        result.terms.push(Term {
            id: id(),
            raw: raw.clone(),
            base: raw,
            key: String::new(),
            kind: "natural".into(),
            weight: Decimal::ONE,
            weighted: false,
            editable: false,
            start: range.start,
            length: range.length,
            base_start: range.start,
            base_length: range.length,
            group: None,
            previous: None,
            next: None,
        });
        offset = range.end();
    }
    append_source(&mut result, &s[byte..], offset);
    if result.valid {
        if let Some(prev) = previous {
            reuse_ids(&mut result.terms, prev);
        }
    }
    result
}

pub fn natural_bytes(s: &str, natural: &[SourceRange]) -> Option<Vec<std::ops::Range<usize>>> {
    let mut chars = s.char_indices().peekable();
    let mut offset = 0;
    let mut byte_at = |target| {
        while offset < target {
            offset += chars.next()?.1.len_utf16();
        }
        (offset == target).then(|| chars.peek().map_or(s.len(), |&(i, _)| i))
    };
    natural
        .iter()
        .map(|range| {
            let a = byte_at(range.start)?;
            let b = byte_at(range.end())?;
            let body = &s[a..b];
            let left = s[..a].rsplit(['\r', '\n']).next().unwrap_or("");
            let right = s[b..].split(['\r', '\n']).next().unwrap_or("");
            (!body.is_empty()
                && !body.contains(['\r', '\n'])
                && body.trim() == body
                && left.trim().is_empty()
                && right.trim().is_empty())
            .then_some(a..b)
        })
        .collect()
}

fn append_source(result: &mut ParseResult, text: &str, offset: usize) {
    if !result.valid || text.is_empty() {
        return;
    }
    let mut part = scan_source(text, offset);
    result.terms.append(&mut part.terms);
    result.valid = part.valid;
    result.error = part.error;
    result.error_offset = part.error_offset;
}

fn protected_chars(s: &str, chars: &[char]) -> Vec<bool> {
    let mut protected = vec![false; chars.len()];
    for m in FACE.find_iter(s) {
        let a = s[..m.start()].chars().count();
        let b = a + m.as_str().chars().count();
        if a > 0 && chars[a - 1].is_alphanumeric() || b < chars.len() && chars[b].is_alphanumeric()
        {
            continue;
        }
        if m.as_str() == ":3"
            && a > 0
            && chars[a - 1] == ')'
            && s[m.end()..].trim_start().starts_with(')')
        {
            continue;
        }
        protected[a..b].fill(true)
    }
    protected
}

fn scan_source(s: &str, offset: usize) -> ParseResult {
    let chars: Vec<char> = s.chars().collect();
    let protected = protected_chars(s, &chars);
    let n = chars.len();
    let mut offsets = Vec::with_capacity(n + 1);
    offsets.push(offset);
    for c in &chars {
        offsets.push(offsets.last().unwrap() + c.len_utf16());
    }
    let mut scan = Scanner {
        chars,
        offsets,
        protected,
        result: ParseResult {
            terms: vec![],
            error: None,
            error_offset: 0,
            valid: true,
        },
    };
    scan.scan(0, n, Decimal::ONE, false, None, true, 0);
    scan.result
}

// Character offsets are returned as byte ranges into this source segment.
pub fn symbol_edits(s: &str, escape: bool) -> Vec<(usize, usize, &'static str)> {
    let chars: Vec<_> = s.chars().collect();
    let mut bytes: Vec<_> = s.char_indices().map(|(i, _)| i).collect();
    bytes.push(s.len());
    let protected = protected_chars(s, &chars);
    let mut edits = Vec::new();
    let mut brackets = Vec::new();
    let mut comma = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' || protected[i] {
            if escape && c == '\\' && i + 1 == chars.len() {
                edits.push((bytes[i], bytes[i], "\\"));
            }
            comma = None;
            i += if c == '\\' { 2 } else { 1 };
            continue;
        }
        if c == '<'
            && chars
                .get(i + 1)
                .is_some_and(|c| c.is_alphabetic() || c.is_whitespace())
        {
            comma = None;
            if let Some(end) = (i + 1..chars.len()).find(|&j| chars[j] == '>') {
                i = end + 1;
                continue;
            }
            if escape {
                edits.push((bytes[i], bytes[i], "\\"));
            }
        } else if "([{".contains(c) {
            brackets.push((c, i));
            comma = None;
        } else if ")]}".contains(c) {
            if brackets
                .last()
                .is_some_and(|&(open, _)| matches!((open, c), ('(', ')') | ('[', ']') | ('{', '}')))
            {
                brackets.pop();
            } else if escape {
                edits.push((bytes[i], bytes[i], "\\"));
            }
            comma = None;
        } else if !escape && brackets.is_empty() && matches!(c, ',' | '，') {
            if let Some(from) = comma {
                edits.push((bytes[from], bytes[i + 1], ""));
            }
            comma = Some(i + 1);
        } else if !matches!(c, ' ' | '\t') {
            comma = None;
        }
        i += 1;
    }
    if escape {
        edits.extend(
            brackets
                .into_iter()
                .map(|(_, i)| (bytes[i], bytes[i], "\\")),
        );
        edits.sort_unstable_by_key(|e| e.0);
    }
    edits
}

fn reuse_ids(terms: &mut [Term], prev: &[Term]) {
    let n = prev.len();
    let m = terms.len();
    let mut used = std::collections::HashSet::new();
    if n * m <= 2_000_000 {
        let mut dp = vec![0u32; (n + 1) * (m + 1)];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                dp[i * (m + 1) + j] =
                    if prev[i].kind == terms[j].kind && prev[i].key == terms[j].key {
                        1 + dp[(i + 1) * (m + 1) + j + 1]
                    } else {
                        dp[(i + 1) * (m + 1) + j].max(dp[i * (m + 1) + j + 1])
                    }
            }
        }
        let (mut a, mut b) = (0, 0);
        while a < n && b < m {
            if prev[a].kind == terms[b].kind && prev[a].key == terms[b].key {
                terms[b].id = prev[a].id.clone();
                used.insert(prev[a].id.clone());
                a += 1;
                b += 1
            } else if dp[(a + 1) * (m + 1) + b] >= dp[a * (m + 1) + b + 1] {
                a += 1
            } else {
                b += 1
            }
        }
    } else {
        for t in terms.iter_mut() {
            if let Some(p) = prev
                .iter()
                .find(|p| p.kind == t.kind && p.key == t.key && !used.contains(&p.id))
            {
                t.id = p.id.clone();
                used.insert(p.id.clone());
            }
        }
    }
    let mut remaining = prev.iter().filter(|p| !used.contains(&p.id));
    for t in terms.iter_mut() {
        if !used.contains(&t.id) {
            if let Some(p) = remaining.next() {
                t.id = p.id.clone()
            }
        }
    }
}
pub fn with_weight(t: &Term, value: Option<Decimal>) -> Result<String, String> {
    if !t.editable {
        return Err("此语法不支持结构化调权，请在正文编辑".into());
    }
    if t.kind == "lora" {
        let at = t.raw.rfind(':').ok_or("LoRA 声明无效")?;
        return Ok(format!(
            "{}{}>",
            &t.raw[..at + 1],
            value.unwrap_or(Decimal::ONE).normalize()
        ));
    }
    Ok(value.map_or(t.base.clone(), |w| {
        format!("({}:{})", t.base, w.normalize())
    }))
}
pub fn char_index(text: &str, utf16: usize) -> usize {
    let mut n = 0;
    for (i, c) in text.char_indices() {
        if n >= utf16 {
            return i;
        }
        n += c.len_utf16()
    }
    text.len()
}
