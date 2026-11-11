use crate::{model::*, parser};
use rust_decimal::Decimal;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
#[derive(Default, Clone)]
pub struct Editor {
    pub project: Project,
    undo: Vec<(Project, Project, Option<(Generation, Generation)>)>,
    redo: Vec<(Project, Project, Option<(Generation, Generation)>)>,
}
impl Editor {
    pub fn current(&self) -> &Workspace {
        self.project.state.current()
    }
    pub fn transact<F>(&mut self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut Self) -> Result<(), String>,
    {
        let before = self.project.clone();
        if let Err(e) = f(self) {
            self.project = before;
            return Err(e);
        }
        self.undo.push((before, self.project.clone(), None));
        if self.undo.len() > 150 {
            self.undo.remove(0);
        }
        self.redo.clear();
        Ok(())
    }
    pub fn load(&mut self, mut p: Project) -> Result<(), String> {
        validate(&mut p)?;
        self.project = p;
        self.undo.clear();
        self.redo.clear();
        Ok(())
    }
    pub fn undo(&mut self) {
        self.undo_with_generation();
    }
    pub fn undo_with_generation(&mut self) -> Option<Generation> {
        if let Some(h) = self.undo.pop() {
            self.project = h.0.clone();
            let generation = h.2.as_ref().map(|g| g.0.clone());
            self.redo.push(h);
            return generation;
        }
        None
    }
    pub fn redo(&mut self) {
        self.redo_with_generation();
    }
    pub fn redo_with_generation(&mut self) -> Option<Generation> {
        if let Some(h) = self.redo.pop() {
            self.project = h.1.clone();
            let generation = h.2.as_ref().map(|g| g.1.clone());
            self.undo.push(h);
            return generation;
        }
        None
    }
    pub fn attach_generation(&mut self, before: Generation, after: Generation) {
        if let Some(h) = self.undo.last_mut() {
            h.2 = Some((before, after));
        }
    }
    pub fn status(&self) -> Value {
        let parsed = parser::parse(&self.current().text, None);
        json!({"project":self.project,"canUndo":!self.undo.is_empty(),"canRedo":!self.redo.is_empty(),"valid":parsed.valid,"error":parsed.error,"errorOffset":parsed.error_offset})
    }
    pub fn require_valid(&self) -> Result<(), String> {
        parser::parse(&self.current().text, None)
            .error
            .map_or(Ok(()), Err)
    }
    fn targets(&self, ids: &[String], active: bool) -> Result<Vec<Term>, String> {
        self.require_valid()?;
        let set: HashSet<_> = ids.iter().collect();
        let w = self.current();
        let all: Vec<_> = w
            .active
            .iter()
            .chain(if active { [].iter() } else { w.hidden.iter() })
            .filter(|t| set.contains(&t.id))
            .cloned()
            .collect();
        if all.is_empty() || all.len() != set.len() {
            Err("请重新选择有效目标；隐藏项须先恢复".into())
        } else {
            Ok(all)
        }
    }
    pub fn set_text(&mut self, text: String) -> Result<(), String> {
        self.transact(|e| {
            e.apply_text(text);
            Ok(())
        })
    }
    fn apply_text(&mut self, text: String) {
        let w = self.project.state.current_mut();
        let old = w.parsed_text.as_ref().unwrap_or(&w.text).clone();
        let parsed = parser::parse(&text, None);
        w.text = text.clone();
        if !parsed.valid {
            return;
        }
        let a: Vec<_> = old.encode_utf16().collect();
        let b: Vec<_> = text.encode_utf16().collect();
        let mut start = 0;
        while start < a.len().min(b.len()) && a[start] == b[start] {
            start += 1
        }
        let mut suffix = 0;
        while suffix < a.len() - start
            && suffix < b.len() - start
            && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix]
        {
            suffix += 1
        }
        let removed = a.len() - start - suffix;
        let inserted = b.len() - start - suffix;
        let end = start + removed;
        let delta = inserted as isize - removed as isize;
        let owner: HashMap<_, _> = w
            .groups
            .iter()
            .flat_map(|g| g.members.iter().map(|id| (id.clone(), g.id.clone())))
            .collect();
        let mut unchanged = HashMap::new();
        let mut affected = vec![];
        let added = String::from_utf16_lossy(&b[start..start + inserted]);
        let expands = removed == 0
            && inserted > 0
            && !added.chars().any(|c| ",;，；\r\n()[]{}<>".contains(c));
        for t in &w.active {
            if expands && (t.start + t.length == start || t.start == start) {
                affected.push(t.clone())
            } else if t.start + t.length <= start {
                unchanged.insert(t.start, t.clone());
            } else if t.start >= end {
                unchanged.insert((t.start as isize + delta) as usize, t.clone());
            } else {
                affected.push(t.clone())
            }
        }
        let touched: HashSet<_> = affected.iter().map(|t| owner.get(&t.id).cloned()).collect();
        let mut inherited = if touched.len() == 1 {
            touched.iter().next().cloned().flatten()
        } else {
            None
        };
        if removed == 0 && inherited.is_none() {
            let left = w.active.iter().rev().find(|t| t.start + t.length <= start);
            let right = w.active.iter().find(|t| t.start >= start);
            if let (Some(l), Some(r)) = (left, right) {
                if owner.get(&l.id).is_some() && owner.get(&l.id) == owner.get(&r.id) {
                    inherited = owner.get(&l.id).cloned()
                }
            }
        }
        let mut queue = affected.into_iter();
        let mut membership = HashMap::new();
        let mut terms = parsed.terms;
        for t in &mut terms {
            if let Some(prior) = unchanged
                .get(&t.start)
                .filter(|p| p.kind == t.kind && p.key == t.key && p.length == t.length)
            {
                t.id = prior.id.clone();
                if let Some(g) = owner.get(&prior.id) {
                    membership.insert(t.id.clone(), g.clone());
                }
            } else {
                if let Some(p) = queue.next() {
                    t.id = p.id
                }
                if let Some(g) = &inherited {
                    membership.insert(t.id.clone(), g.clone());
                }
            }
        }
        let hidden: HashSet<_> = w.hidden.iter().map(|t| t.id.clone()).collect();
        for g in &mut w.groups {
            let old = g.members.clone();
            let mut members: Vec<_> = terms
                .iter()
                .filter(|t| membership.get(&t.id) == Some(&g.id))
                .map(|t| t.id.clone())
                .collect();
            for (i, id) in old.iter().enumerate() {
                if hidden.contains(id) {
                    let pos = old[i + 1..]
                        .iter()
                        .find_map(|n| members.iter().position(|m| m == n))
                        .unwrap_or(members.len());
                    members.insert(pos, id.clone())
                }
            }
            g.members = members
        }
        w.active = terms;
        w.parsed_text = Some(text);
        refresh(w);
        for g in &mut w.groups {
            let mut entered = false;
            let mut exited = false;
            for t in &w.active {
                if g.members.contains(&t.id) {
                    if exited {
                        g.members.retain(|id| id != &t.id)
                    }
                    entered = true
                } else if entered {
                    exited = true
                }
            }
        }
        refresh(w);
    }
    fn sync(&mut self) -> Result<(), String> {
        let w = self.project.state.current_mut();
        let text = w
            .active
            .iter()
            .map(Term::display)
            .collect::<Vec<_>>()
            .join(", ");
        let p = parser::parse(&text, None);
        if !p.valid || p.terms.len() != w.active.len() {
            return Err("操作会改变语法边界，已取消，请在正文编辑".into());
        }
        let mut terms = p.terms;
        for (a, b) in terms.iter_mut().zip(w.active.iter()) {
            a.id = b.id.clone()
        }
        w.text = text.clone();
        w.parsed_text = Some(text);
        w.active = terms;
        refresh(w);
        Ok(())
    }
    pub fn weight(
        &mut self,
        ids: &[String],
        value: Option<Decimal>,
        relative: bool,
    ) -> Result<(), String> {
        let targets = self.targets(ids, true)?;
        if targets.iter().any(|t| !t.editable) {
            return Err("所选项含无法确定权重语义的语法，整批未提交".into());
        }
        self.transact(|e| {
            for t in &mut e.project.state.current_mut().active {
                if ids.contains(&t.id) {
                    let v = if relative {
                        Some(
                            t.weight
                                .checked_add(value.unwrap_or(Decimal::ZERO))
                                .ok_or("权重超出范围")?,
                        )
                    } else {
                        value
                    };
                    t.raw = parser::with_weight(t, v)?;
                    t.group = None;
                }
            }
            e.sync()
        })
    }
    pub fn hide(&mut self, ids: &[String]) -> Result<(), String> {
        self.targets(ids, true)?;
        self.transact(|e| {
            let w = e.project.state.current_mut();
            for (i, t) in w.active.iter().enumerate() {
                if ids.contains(&t.id) {
                    let mut t = t.clone();
                    t.previous = i.checked_sub(1).map(|i| w.active[i].id.clone());
                    t.next = w.active.get(i + 1).map(|t| t.id.clone());
                    t.raw = t.display();
                    t.group = None;
                    w.hidden.push(t)
                }
            }
            w.active.retain(|t| !ids.contains(&t.id));
            e.sync()
        })
    }
    pub fn restore(&mut self, ids: &[String]) -> Result<(), String> {
        let targets = self.targets(ids, false)?;
        if targets
            .iter()
            .any(|t| !self.current().hidden.iter().any(|h| h.id == t.id))
        {
            return Err("恢复只能作用于隐藏项".into());
        }
        self.transact(|e| {
            let w = e.project.state.current_mut();
            let mut grouped = Vec::new();
            let mut loose = Vec::new();
            for t in targets {
                if w.groups.iter().any(|g| g.members.contains(&t.id)) {
                    grouped.push(t);
                } else {
                    loose.push(t);
                }
            }
            w.active.extend(grouped);
            let restored: HashSet<_> = ids.iter().cloned().collect();
            w.hidden.retain(|t| !restored.contains(&t.id));
            flatten(w);
            for t in loose.into_iter().rev() {
                let group = w.groups.iter().find(|g| g.members.contains(&t.id));
                let at = if let Some(g) = group {
                    let n = g.members.iter().position(|id| id == &t.id).unwrap();
                    g.members[n + 1..]
                        .iter()
                        .find_map(|id| w.active.iter().position(|a| &a.id == id))
                        .or_else(|| {
                            g.members[..n].iter().rev().find_map(|id| {
                                w.active.iter().position(|a| &a.id == id).map(|p| p + 1)
                            })
                        })
                        .unwrap_or(w.active.len())
                } else {
                    let prev = t
                        .previous
                        .as_ref()
                        .and_then(|id| w.active.iter().position(|a| &a.id == id));
                    let next = t
                        .next
                        .as_ref()
                        .and_then(|id| w.active.iter().position(|a| &a.id == id));
                    let p = match (prev, next) {
                        (Some(a), Some(b)) if a < b => a + 1,
                        (Some(a), None) => a + 1,
                        (None, Some(b)) => b,
                        _ => w.active.len(),
                    };
                    if p > 0 && p < w.active.len() {
                        if let Some(g) = w.groups.iter().find(|g| {
                            g.members.contains(&w.active[p - 1].id)
                                && g.members.contains(&w.active[p].id)
                        }) {
                            w.active
                                .iter()
                                .rposition(|a| g.members.contains(&a.id))
                                .unwrap()
                                + 1
                        } else {
                            p
                        }
                    } else {
                        p
                    }
                };
                w.active.insert(at, t);
            }
            w.hidden.retain(|t| !ids.contains(&t.id));
            e.sync()
        })
    }
    pub fn delete(&mut self, ids: &[String]) -> Result<(), String> {
        self.targets(ids, false)?;
        self.transact(|e| {
            let w = e.project.state.current_mut();
            w.active.retain(|t| !ids.contains(&t.id));
            w.hidden.retain(|t| !ids.contains(&t.id));
            e.sync()
        })
    }
    pub fn insert(
        &mut self,
        text: &str,
        start: usize,
        length: usize,
        completion: bool,
    ) -> Result<(), String> {
        self.require_valid()?;
        self.transact(|e| e.insert_core(text, start, length, completion).map(|_| ()))
    }
    fn insert_core(
        &mut self,
        text: &str,
        start: usize,
        length: usize,
        completion: bool,
    ) -> Result<Vec<String>, String> {
        let w = self.current();
        let a = parser::char_index(&w.text, start);
        let b = parser::char_index(&w.text, start + length);
        let left = &w.text[..a];
        let right = &w.text[b..];
        let mut text = text.to_string();
        if !completion {
            if left
                .trim_end()
                .chars()
                .last()
                .is_some_and(|c| !",;，；\n( ".contains(c))
            {
                text = format!(", {}", text)
            }
            if right
                .trim_start()
                .chars()
                .next()
                .is_some_and(|c| !",;，；\n) ".contains(c))
            {
                text.push_str(", ")
            }
        }
        let next = format!("{}{}{}", left, text, right);
        if let Some(err) = parser::parse(&next, None).error {
            return Err(err);
        }
        let len = text.encode_utf16().count();
        self.apply_text(next);
        self.project.state.current_mut().caret = start + len;
        Ok(self
            .current()
            .active
            .iter()
            .filter(|t| t.start >= start && t.start + t.length <= start + len)
            .map(|t| t.id.clone())
            .collect())
    }
    pub fn group(
        &mut self,
        ids: &[String],
        name: &str,
        category: &str,
        description: &str,
    ) -> Result<(), String> {
        self.targets(ids, true)?;
        if !CATEGORIES.contains(&category) {
            return Err("请选择有效类别".into());
        }
        self.transact(|e| e.group_core(ids, name, category, description))
    }
    fn group_core(
        &mut self,
        ids: &[String],
        name: &str,
        category: &str,
        description: &str,
    ) -> Result<(), String> {
        let w = self.project.state.current_mut();
        let previous_order: Vec<_> = w.active.iter().map(|t| t.id.clone()).collect();
        if let Some(g) = w.groups.iter_mut().find(|g| {
            g.members
                .iter()
                .filter(|id| w.active.iter().any(|t| &t.id == *id))
                .count()
                == ids.len()
                && ids.iter().all(|id| g.members.contains(id))
        }) {
            g.name = name.into();
            g.category = category.into();
            g.description = Some(description.trim().into());
            return Ok(());
        }
        let selected: Vec<_> = w
            .active
            .iter()
            .filter(|t| ids.contains(&t.id))
            .cloned()
            .collect();
        let first = w
            .active
            .iter()
            .position(|t| t.id == selected[0].id)
            .unwrap();
        let source = w
            .groups
            .iter()
            .find(|g| g.members.contains(&selected[0].id))
            .cloned();
        w.active.retain(|t| !ids.contains(&t.id));
        let at = source
            .and_then(|g| {
                w.active
                    .iter()
                    .rposition(|t| g.members.contains(&t.id))
                    .map(|i| i + 1)
            })
            .unwrap_or(first.min(w.active.len()));
        for g in &mut w.groups {
            g.members.retain(|id| !ids.contains(id))
        }
        w.groups.push(VisualGroup {
            id: id(),
            name: name.into(),
            category: category.into(),
            description: Some(description.trim().into()),
            members: selected.iter().map(|t| t.id.clone()).collect(),
        });
        w.active.splice(at..at, selected);
        let changed = !w.active.iter().map(|t| &t.id).eq(previous_order.iter());
        refresh(w);
        if changed {
            self.sync()
        } else {
            Ok(())
        }
    }
    pub fn edit_group(
        &mut self,
        id: &str,
        name: &str,
        category: &str,
        description: &str,
    ) -> Result<(), String> {
        if !CATEGORIES.contains(&category) {
            return Err("未知类别".into());
        }
        self.transact(|e| {
            let g = e
                .project
                .state
                .current_mut()
                .groups
                .iter_mut()
                .find(|g| g.id == id)
                .ok_or("组不存在")?;
            g.name = name.into();
            g.category = category.into();
            g.description = Some(description.trim().into());
            Ok(())
        })
    }
    pub fn dissolve(&mut self, id: &str) -> Result<(), String> {
        self.transact(|e| {
            e.project.state.current_mut().groups.retain(|g| g.id != id);
            refresh(e.project.state.current_mut());
            Ok(())
        })
    }

    pub fn detach(&mut self, ids: &[String]) -> Result<(), String> {
        let targets = self.targets(ids, true)?;
        let group = self
            .current()
            .groups
            .iter()
            .find(|g| g.members.contains(&targets[0].id));
        let target = group
            .and_then(|g| {
                self.current()
                    .active
                    .iter()
                    .rev()
                    .find(|t| g.members.contains(&t.id) && !ids.contains(&t.id))
            })
            .map(|t| t.id.clone())
            .unwrap_or_default();
        self.move_terms(ids, &target, true, None, None)
    }
    pub fn move_terms(
        &mut self,
        ids: &[String],
        target: &str,
        after: bool,
        group: Option<&str>,
        block: Option<&str>,
    ) -> Result<(), String> {
        let targets = self.targets(ids, true)?;
        let mut target = if target.is_empty() {
            None
        } else {
            Some(target.to_string())
        };
        let mut after = after;
        if target.as_ref().is_some_and(|id| ids.contains(id)) {
            if group.is_some()
                || !targets.iter().any(|t| {
                    self.current()
                        .groups
                        .iter()
                        .any(|g| g.members.contains(&t.id))
                })
            {
                return Ok(());
            }
            let edge = if after {
                self.current()
                    .active
                    .iter()
                    .rposition(|t| ids.contains(&t.id))
                    .unwrap()
            } else {
                self.current()
                    .active
                    .iter()
                    .position(|t| ids.contains(&t.id))
                    .unwrap()
            };
            target = if after {
                self.current()
                    .active
                    .iter()
                    .skip(edge + 1)
                    .find(|t| !ids.contains(&t.id))
            } else {
                self.current().active[..edge]
                    .iter()
                    .rev()
                    .find(|t| !ids.contains(&t.id))
            }
            .map(|t| t.id.clone());
            after = !after;
            if target.is_none() && after {
                target = self
                    .current()
                    .active
                    .iter()
                    .find(|t| !ids.contains(&t.id))
                    .map(|t| t.id.clone());
                after = false
            }
        }
        let was_hidden = group.is_some_and(|id| {
            self.current()
                .groups
                .iter()
                .find(|g| g.id == id)
                .is_some_and(|g| {
                    !self
                        .current()
                        .active
                        .iter()
                        .any(|t| g.members.contains(&t.id))
                })
        });
        self.transact(|e| {
            let w = e.project.state.current_mut();
            for g in &mut w.groups {
                g.members.retain(|id| !ids.contains(id))
            }
            if group.is_none()
                && target.is_none()
                && block.is_some_and(|b| w.layout.iter().any(|k| k == b))
            {
                w.layout.retain(|k| !ids.contains(k));
                let at = w
                    .layout
                    .iter()
                    .position(|k| Some(k.as_str()) == block)
                    .unwrap()
                    + usize::from(after);
                w.layout
                    .splice(at..at, targets.iter().map(|t| t.id.clone()));
                flatten(w);
                refresh(w);
                return e.sync();
            }
            let mut rest: Vec<_> = w
                .active
                .iter()
                .filter(|t| !ids.contains(&t.id))
                .cloned()
                .collect();
            let mut at = target
                .as_ref()
                .and_then(|id| rest.iter().position(|t| &t.id == id))
                .map(|p| p + usize::from(after))
                .unwrap_or(rest.len());
            if let Some(gid) = group {
                let g = w
                    .groups
                    .iter_mut()
                    .find(|g| g.id == gid)
                    .ok_or("目标组不存在")?;
                let pos = target
                    .as_ref()
                    .and_then(|id| g.members.iter().position(|m| m == id))
                    .map(|p| p + usize::from(after))
                    .unwrap_or(g.members.len());
                g.members
                    .splice(pos..pos, targets.iter().map(|t| t.id.clone()));
                if target.is_none() {
                    if let Some(end) = rest.iter().rposition(|t| g.members.contains(&t.id)) {
                        at = end + 1
                    }
                }
            } else if let Some(id) = &target {
                if let Some(g) = w.groups.iter().find(|g| g.members.contains(id)) {
                    at = if after {
                        rest.iter()
                            .rposition(|t| g.members.contains(&t.id))
                            .unwrap()
                            + 1
                    } else {
                        rest.iter().position(|t| g.members.contains(&t.id)).unwrap()
                    }
                }
            }
            rest.splice(at..at, targets);
            w.active = rest;
            if was_hidden {
                flatten(w)
            }
            refresh(w);
            e.sync()
        })
    }
    pub fn move_group(&mut self, id: &str, target: &str, after: bool) -> Result<(), String> {
        self.require_valid()?;
        self.transact(|e| {
            let w = e.project.state.current_mut();
            let key = format!("group:{}", id);
            if key == target {
                return Ok(());
            }
            w.layout.retain(|k| k != &key);
            let at = w
                .layout
                .iter()
                .position(|k| k == target)
                .unwrap_or(w.layout.len())
                + usize::from(after);
            w.layout.insert(at, key);
            flatten(w);
            e.sync()
        })
    }
    pub fn insert_favorite(
        &mut self,
        f: &Favorite,
        start: usize,
        length: usize,
    ) -> Result<(), String> {
        self.require_valid()?;
        let parsed = parser::parse(&f.text, None);
        if !CATEGORIES.contains(&f.category.as_str()) || !parsed.valid || parsed.terms.is_empty() {
            return Err("收藏片段语法或类别无效".into());
        }
        self.transact(|e| {
            let mut start = start;
            let mut length = length;
            let owner = |id: &str| {
                e.current()
                    .groups
                    .iter()
                    .find(|g| g.members.iter().any(|m| m == id))
                    .map(|g| g.id.clone())
            };
            let mut source = e
                .current()
                .active
                .iter()
                .find(|t| start > t.start && start < t.start + t.length)
                .and_then(|t| owner(&t.id));
            if length > 0 {
                let owners: HashSet<_> = e
                    .current()
                    .active
                    .iter()
                    .filter(|t| t.start < start + length && t.start + t.length > start)
                    .map(|t| owner(&t.id))
                    .collect();
                if owners.len() == 1 {
                    source = owners.into_iter().next().flatten();
                }
            }
            if source.is_none() {
                let left = e
                    .current()
                    .active
                    .iter()
                    .rev()
                    .find(|t| t.start + t.length <= start);
                let right = e.current().active.iter().find(|t| t.start >= start);
                if let (Some(a), Some(b)) = (left, right) {
                    if owner(&a.id) == owner(&b.id) {
                        source = owner(&a.id)
                    }
                }
            }
            if let Some(gid) = &source {
                if length > 0 {
                    let text = &e.current().text;
                    let a = parser::char_index(text, start);
                    let b = parser::char_index(text, start + length);
                    let next = format!("{}{}", &text[..a], &text[b..]);
                    if let Some(error) = parser::parse(&next, None).error {
                        return Err(error);
                    }
                    e.apply_text(next);
                }
                e.sync()?;
                if let Some(g) = e.current().groups.iter().find(|g| &g.id == gid) {
                    if let Some(last) = e
                        .current()
                        .active
                        .iter()
                        .rev()
                        .find(|t| g.members.contains(&t.id))
                    {
                        start = insertion_end(e.current(), last)
                    } else {
                        start = start.min(e.current().text.encode_utf16().count())
                    }
                }
                length = 0;
            }
            let ids = e.insert_core(&f.text, start, length, false)?;
            if ids.len() != parsed.terms.len() {
                return Err("插入位置无法明确识别，请把光标放在词条之间".into());
            }
            let w = e.project.state.current_mut();
            for g in &mut w.groups {
                g.members.retain(|id| !ids.contains(id))
            }
            let mut members = vec![];
            for t in &mut w.active {
                if ids.contains(&t.id) {
                    t.id = id();
                    members.push(t.id.clone())
                }
            }
            let gid = id();
            w.groups.push(VisualGroup {
                id: gid.clone(),
                name: f.name.clone(),
                category: f.category.clone(),
                description: None,
                members,
            });
            refresh(w);
            if let Some(source) = source {
                if let Some(g) = w.groups.iter().find(|g| g.id == source) {
                    if !w.active.iter().any(|t| g.members.contains(&t.id)) {
                        let key = format!("group:{}", gid);
                        w.layout.retain(|k| k != &key);
                        if let Some(at) = w
                            .layout
                            .iter()
                            .position(|k| k == &format!("group:{}", source))
                        {
                            w.layout.insert(at + 1, key);
                            flatten(w);
                            refresh(w)
                        }
                    }
                }
            }
            Ok(())
        })
    }
    pub fn create_favorite<F>(
        &mut self,
        ids: &[String],
        name: &str,
        category: &str,
        persist: F,
    ) -> Result<Favorite, String>
    where
        F: FnOnce(&Favorite) -> Result<(), String>,
    {
        let terms = self.targets(ids, true)?;
        if name.trim().is_empty() {
            return Err("请输入收藏名称".into());
        }
        let f = Favorite {
            id: id(),
            name: name.trim().into(),
            text: terms
                .iter()
                .map(Term::display)
                .collect::<Vec<_>>()
                .join(", "),
            category: category.into(),
            images: vec![],
        };
        self.transact(|e| {
            let reusable = e
                .current()
                .groups
                .iter()
                .find(|g| {
                    ids.iter().all(|id| g.members.contains(id))
                        && g.members
                            .iter()
                            .filter(|id| e.current().active.iter().any(|t| &t.id == *id))
                            .count()
                            == ids.len()
                })
                .cloned();
            if let Some(g) = reusable {
                e.group_core(
                    ids,
                    &g.name,
                    category,
                    g.description.as_deref().unwrap_or(""),
                )?
            } else {
                e.group_core(ids, name.trim(), category, "")?
            }
            persist(&f)
        })?;
        Ok(f)
    }
    pub fn snapshot(&mut self, name: &str) -> Result<(), String> {
        self.snapshot_with_generation(name, None)
    }
    pub fn snapshot_with_generation(&mut self, name: &str, generation: Option<Generation>) -> Result<(), String> {
        if name.trim().is_empty() {
            return Err("快照名称不能为空".into());
        }
        self.transact(|e| {
            e.project.snapshots.push(Snapshot {
                id: id(),
                name: name.trim().into(),
                created: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                state: e.project.state.clone(),
                generation,
                comfy_group_targets: Some(e.project.comfy_group_targets.clone()),
            });
            Ok(())
        })
    }
    pub fn restore_snapshot(&mut self, id: &str) -> Result<(), String> {
        self.transact(|e| {
            if let Some(targets) = e.project.snapshots.iter().find(|s| s.id == id).ok_or("快照不存在")?.comfy_group_targets.clone() {
                e.project.comfy_group_targets = targets;
            }
            e.project.state = e
                .project
                .snapshots
                .iter()
                .find(|s| s.id == id)
                .ok_or("快照不存在")?
                .state
                .clone();
            Ok(())
        })
    }
}
fn insertion_end(w: &Workspace, t: &Term) -> usize {
    let end = t.start + t.length;
    let Some(group) = &t.group else { return end };
    let Some(start) = group
        .strip_prefix('g')
        .and_then(|s| s.parse::<usize>().ok())
    else {
        return end;
    };
    let chars: Vec<_> = w.text.encode_utf16().collect();
    let mut depth = 0;
    let mut i = start;
    while i < chars.len() {
        if chars[i] == b'\\' as u16 {
            i += 2;
            continue;
        }
        if chars[i] == b'(' as u16 {
            depth += 1
        } else if chars[i] == b')' as u16 {
            depth -= 1;
            if depth == 0 {
                return i + 1;
            }
        }
        i += 1
    }
    end
}
pub fn refresh(w: &mut Workspace) {
    let all: HashSet<_> = w
        .active
        .iter()
        .chain(&w.hidden)
        .map(|t| t.id.clone())
        .collect();
    for g in &mut w.groups {
        g.members.retain(|id| all.contains(id))
    }
    w.groups.retain(|g| !g.members.is_empty());
    let owner: HashMap<_, _> = w
        .groups
        .iter()
        .flat_map(|g| {
            g.members
                .iter()
                .map(|id| (id.clone(), format!("group:{}", g.id)))
        })
        .collect();
    let old = w.layout.clone();
    let mut layout = vec![];
    for t in &w.active {
        let key = owner.get(&t.id).cloned().unwrap_or(t.id.clone());
        if !layout.contains(&key) {
            layout.push(key)
        }
    }
    for g in &w.groups {
        let key = format!("group:{}", g.id);
        if !layout.contains(&key) {
            let at = old
                .iter()
                .position(|k| k == &key)
                .and_then(|p| {
                    old[..p]
                        .iter()
                        .rev()
                        .find_map(|k| layout.iter().position(|x| x == k).map(|i| i + 1))
                        .or_else(|| {
                            old[p + 1..]
                                .iter()
                                .find_map(|k| layout.iter().position(|x| x == k))
                        })
                })
                .unwrap_or(layout.len());
            layout.insert(at, key)
        }
    }
    w.layout = layout;
}
fn flatten(w: &mut Workspace) {
    let active: HashMap<_, _> = w.active.iter().map(|t| (t.id.clone(), t.clone())).collect();
    let owned: HashSet<_> = w.groups.iter().flat_map(|g| g.members.iter()).collect();
    let mut terms = vec![];
    for key in &w.layout {
        if let Some(id) = key.strip_prefix("group:") {
            if let Some(g) = w.groups.iter().find(|g| g.id == id) {
                for id in &g.members {
                    if let Some(t) = active.get(id) {
                        terms.push(t.clone())
                    }
                }
            }
        } else if let Some(t) = active.get(key).filter(|_| !owned.contains(key)) {
            terms.push(t.clone())
        }
    }
    let included: HashSet<_> = terms.iter().map(|t| t.id.clone()).collect();
    terms.extend(
        w.active
            .iter()
            .filter(|t| !included.contains(&t.id))
            .cloned(),
    );
    w.active = terms;
}
pub fn validate(p: &mut Project) -> Result<(), String> {
    if ![1, 2].contains(&p.version) || p.parser_version != 1 {
        return Err("项目损坏或格式版本不支持".into());
    }
    let legacy = p.version == 1;
    fn state(s: &mut EditingState, legacy: bool) -> Result<(), String> {
        for w in [&mut s.positive, &mut s.negative] {
            let mut ids = HashSet::new();
            if w.active
                .iter()
                .chain(&w.hidden)
                .any(|t| t.id.trim().is_empty() || !ids.insert(t.id.clone()))
            {
                return Err("条目身份损坏或重复".into());
            }
            if legacy {
                w.groups.clear();
                w.layout.clear()
            }
            let mut gids = HashSet::new();
            let mut members = HashSet::new();
            for g in &w.groups {
                if g.id.is_empty()
                    || !gids.insert(g.id.clone())
                    || !CATEGORIES.contains(&g.category.as_str())
                    || g.members.is_empty()
                    || g.members
                        .iter()
                        .any(|id| !ids.contains(id) || !members.insert(id.clone()))
                {
                    return Err("视觉组成员损坏或重复归属".into());
                }
                let indices: Vec<_> = w
                    .active
                    .iter()
                    .enumerate()
                    .filter(|(_, t)| g.members.contains(&t.id))
                    .map(|(i, _)| i)
                    .collect();
                let active_members: Vec<_> = w
                    .active
                    .iter()
                    .filter(|t| g.members.contains(&t.id))
                    .map(|t| &t.id)
                    .collect();
                let stored_order: Vec<_> = g
                    .members
                    .iter()
                    .filter(|id| w.active.iter().any(|t| &t.id == *id))
                    .collect();
                if (!indices.is_empty()
                    && indices.last().unwrap() - indices[0] + 1 != indices.len())
                    || active_members != stored_order
                {
                    return Err("组内顺序或连续性损坏".into());
                }
            }
            let group_keys: HashSet<_> =
                w.groups.iter().map(|g| format!("group:{}", g.id)).collect();
            let active_ids: HashSet<_> = w.active.iter().map(|t| &t.id).collect();
            let mut layout_keys = HashSet::new();
            if w.layout.iter().any(|key| {
                !layout_keys.insert(key)
                    || (!group_keys.contains(key)
                        && (!active_ids.contains(key) || members.contains(key)))
            }) || group_keys.iter().any(|key| !w.layout.contains(key))
            {
                return Err("视觉组位置数据损坏".into());
            }
            let parsed = parser::parse(&w.text, Some(&w.active));
            if parsed.valid {
                w.active = parsed.terms;
                w.parsed_text = Some(w.text.clone())
            }
            refresh(w)
        }
        Ok(())
    }
    state(&mut p.state, legacy)?;
    for s in &mut p.snapshots {
        state(&mut s.state, legacy)?
    }
    p.version = 2;
    Ok(())
}
pub fn format_prompt(w: &Workspace) -> String {
    let owner: HashMap<_, _> = w
        .groups
        .iter()
        .filter(|g| g.description.as_ref().is_some_and(|d| !d.trim().is_empty()))
        .flat_map(|g| g.members.iter().map(move |id| (id, g)))
        .collect();
    let mut output: Vec<_> = w
        .active
        .iter()
        .filter(|t| !owner.contains_key(&t.id))
        .map(Term::display)
        .collect();
    let mut seen = HashSet::new();
    for t in &w.active {
        if let Some(g) = owner.get(&t.id) {
            if seen.insert(&g.id) {
                let body = w
                    .active
                    .iter()
                    .filter(|t| g.members.contains(&t.id))
                    .map(Term::display)
                    .collect::<Vec<_>>()
                    .join(", ");
                let prefix = g.description.as_ref().unwrap().trim();
                output.push(format!(
                    "{}{}{}.",
                    prefix,
                    if prefix.ends_with(':') || prefix.ends_with('：') {
                        " "
                    } else {
                        ": "
                    },
                    body.trim_end().trim_end_matches(['.', '。']).trim_end()
                ));
            }
        }
    }
    output.join(", ")
}
pub fn compare(before: &EditingState, after: &EditingState) -> Vec<Value> {
    let mut out = vec![];
    for (a, b, label) in [
        (&before.positive, &after.positive, "积极"),
        (&before.negative, &after.negative, "消极"),
    ] {
        let aa: HashMap<_, _> = a
            .active
            .iter()
            .chain(&a.hidden)
            .map(|t| (&t.id, t))
            .collect();
        let bb: HashMap<_, _> = b
            .active
            .iter()
            .chain(&b.hidden)
            .map(|t| (&t.id, t))
            .collect();
        let mut ids: Vec<_> = a
            .active
            .iter()
            .chain(&a.hidden)
            .chain(&b.active)
            .chain(&b.hidden)
            .map(|t| &t.id)
            .collect();
        let mut seen = HashSet::new();
        ids.retain(|id| seen.insert(*id));
        for id in ids {
            let x = aa.get(id);
            let y = bb.get(id);
            let term = y.or(x).unwrap().base.clone();
            let mut add = |kind: &str, old: String, new: String| {
                out.push(
                    json!({"Workspace":label,"Kind":kind,"Term":term,"Before":old,"After":new}),
                )
            };
            match (x, y) {
                (None, Some(y)) => add("新增", "—".into(), y.display()),
                (Some(x), None) => add("删除", x.display(), "—".into()),
                (Some(x), Some(y)) => {
                    if x.base != y.base {
                        add("原文", x.base.clone(), y.base.clone())
                    }
                    if x.weight != y.weight || x.weighted != y.weighted {
                        add("权重", x.weight.to_string(), y.weight.to_string())
                    }
                    let ah = a.hidden.iter().any(|t| &t.id == id);
                    let bh = b.hidden.iter().any(|t| &t.id == id);
                    if ah != bh {
                        add(
                            "隐藏 / 恢复",
                            if ah { "隐藏" } else { "有效" }.into(),
                            if bh { "隐藏" } else { "有效" }.into(),
                        )
                    }
                }
                _ => (),
            }
        }
    }
    out
}
