export namespace config {
	
	export class LinkSnapshot {
	    skillIds: string[];
	    savedAt: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new LinkSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skillIds = source["skillIds"];
	        this.savedAt = source["savedAt"];
	        this.count = source["count"];
	    }
	}
	export class ToolMapping {
	    id: string;
	    path: string;
	    enabled: boolean;
	    isHub?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ToolMapping(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.enabled = source["enabled"];
	        this.isHub = source["isHub"];
	    }
	}
	export class Config {
	    hubPath: string;
	    tools: ToolMapping[];
	    trashRetentionDays: number;
	    deepScanIgnoreExtra: string[];
	    allowPermanentDelete: boolean;
	    linkSnapshots?: Record<string, LinkSnapshot>;
	    skillsLayout?: string;
	    collapsedSkillGroups?: string[];
	    translationEngine?: string;
	    translationTargetLanguage?: string;
	    microsoftTranslatorKey?: string;
	    microsoftTranslatorRegion?: string;
	    openAIBaseURL?: string;
	    openAIAPIKey?: string;
	    openAIModel?: string;
	    openAITemperature: number;
	    logDebug?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hubPath = source["hubPath"];
	        this.tools = this.convertValues(source["tools"], ToolMapping);
	        this.trashRetentionDays = source["trashRetentionDays"];
	        this.deepScanIgnoreExtra = source["deepScanIgnoreExtra"];
	        this.allowPermanentDelete = source["allowPermanentDelete"];
	        this.linkSnapshots = this.convertValues(source["linkSnapshots"], LinkSnapshot, true);
	        this.skillsLayout = source["skillsLayout"];
	        this.collapsedSkillGroups = source["collapsedSkillGroups"];
	        this.translationEngine = source["translationEngine"];
	        this.translationTargetLanguage = source["translationTargetLanguage"];
	        this.microsoftTranslatorKey = source["microsoftTranslatorKey"];
	        this.microsoftTranslatorRegion = source["microsoftTranslatorRegion"];
	        this.openAIBaseURL = source["openAIBaseURL"];
	        this.openAIAPIKey = source["openAIAPIKey"];
	        this.openAIModel = source["openAIModel"];
	        this.openAITemperature = source["openAITemperature"];
	        this.logDebug = source["logDebug"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace domain {
	
	export class ReportItem {
	    skillId: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ReportItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skillId = source["skillId"];
	        this.message = source["message"];
	    }
	}
	export class AddWorkdirsResult {
	    added: ReportItem[];
	    linked: ReportItem[];
	    skipped: ReportItem[];
	    failed: ReportItem[];
	
	    static createFrom(source: any = {}) {
	        return new AddWorkdirsResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.added = this.convertValues(source["added"], ReportItem);
	        this.linked = this.convertValues(source["linked"], ReportItem);
	        this.skipped = this.convertValues(source["skipped"], ReportItem);
	        this.failed = this.convertValues(source["failed"], ReportItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BulkLinkFailure {
	    skillId?: string;
	    path?: string;
	    reason: string;
	
	    static createFrom(source: any = {}) {
	        return new BulkLinkFailure(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skillId = source["skillId"];
	        this.path = source["path"];
	        this.reason = source["reason"];
	    }
	}
	export class BulkLinkTotals {
	    linked: number;
	    removed: number;
	    skipped: number;
	    failed: number;
	
	    static createFrom(source: any = {}) {
	        return new BulkLinkTotals(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.linked = source["linked"];
	        this.removed = source["removed"];
	        this.skipped = source["skipped"];
	        this.failed = source["failed"];
	    }
	}
	export class ToolBulkLinkResult {
	    toolId: string;
	    linked: number;
	    removed: number;
	    skipped: number;
	    failed?: BulkLinkFailure[];
	
	    static createFrom(source: any = {}) {
	        return new ToolBulkLinkResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.toolId = source["toolId"];
	        this.linked = source["linked"];
	        this.removed = source["removed"];
	        this.skipped = source["skipped"];
	        this.failed = this.convertValues(source["failed"], BulkLinkFailure);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BulkLinkResult {
	    tools: ToolBulkLinkResult[];
	    totals: BulkLinkTotals;
	
	    static createFrom(source: any = {}) {
	        return new BulkLinkResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tools = this.convertValues(source["tools"], ToolBulkLinkResult);
	        this.totals = this.convertValues(source["totals"], BulkLinkTotals);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class CanExecuteResult {
	    ok: boolean;
	    reason: string;
	
	    static createFrom(source: any = {}) {
	        return new CanExecuteResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.reason = source["reason"];
	    }
	}
	export class ConflictFile {
	    relativePath: string;
	    status: string;
	    choice?: string;
	    mergedContent?: string;
	    isText: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ConflictFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.relativePath = source["relativePath"];
	        this.status = source["status"];
	        this.choice = source["choice"];
	        this.mergedContent = source["mergedContent"];
	        this.isText = source["isText"];
	    }
	}
	export class ConflictFileTexts {
	    skillId: string;
	    rel: string;
	    sideA: string;
	    sideB: string;
	
	    static createFrom(source: any = {}) {
	        return new ConflictFileTexts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skillId = source["skillId"];
	        this.rel = source["rel"];
	        this.sideA = source["sideA"];
	        this.sideB = source["sideB"];
	    }
	}
	export class ConflictSkill {
	    skillId: string;
	    sideA: string;
	    sideB: string;
	    files: ConflictFile[];
	    userSkipped: boolean;
	    index: number;
	    total: number;
	    pendingSources?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ConflictSkill(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skillId = source["skillId"];
	        this.sideA = source["sideA"];
	        this.sideB = source["sideB"];
	        this.files = this.convertValues(source["files"], ConflictFile);
	        this.userSkipped = source["userSkipped"];
	        this.index = source["index"];
	        this.total = source["total"];
	        this.pendingSources = source["pendingSources"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExportToolSkillsResult {
	    zipPath: string;
	    exported: number;
	    skipped: number;
	
	    static createFrom(source: any = {}) {
	        return new ExportToolSkillsResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.zipPath = source["zipPath"];
	        this.exported = source["exported"];
	        this.skipped = source["skipped"];
	    }
	}
	export class GroupInfo {
	    id: string;
	
	    static createFrom(source: any = {}) {
	        return new GroupInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	    }
	}
	export class ImportSkillItem {
	    id: string;
	    status: string;
	    reason?: string;
	
	    static createFrom(source: any = {}) {
	        return new ImportSkillItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.status = source["status"];
	        this.reason = source["reason"];
	    }
	}
	export class ImportSkillsResult {
	    imported: number;
	    skipped: number;
	    failed: number;
	    items: ImportSkillItem[];
	
	    static createFrom(source: any = {}) {
	        return new ImportSkillsResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.imported = source["imported"];
	        this.skipped = source["skipped"];
	        this.failed = source["failed"];
	        this.items = this.convertValues(source["items"], ImportSkillItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class OrganizeAction {
	    skillId: string;
	    type: string;
	    sources: string[];
	    selected: boolean;
	    hubPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new OrganizeAction(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skillId = source["skillId"];
	        this.type = source["type"];
	        this.sources = source["sources"];
	        this.selected = source["selected"];
	        this.hubPath = source["hubPath"];
	    }
	}
	export class OrganizePlan {
	    actions: OrganizeAction[];
	    conflicts: ConflictSkill[];
	
	    static createFrom(source: any = {}) {
	        return new OrganizePlan(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.actions = this.convertValues(source["actions"], OrganizeAction);
	        this.conflicts = this.convertValues(source["conflicts"], ConflictSkill);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SuggestedWorkdir {
	    path: string;
	    skillIds: string[];
	    skillCount: number;
	
	    static createFrom(source: any = {}) {
	        return new SuggestedWorkdir(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.skillIds = source["skillIds"];
	        this.skillCount = source["skillCount"];
	    }
	}
	export class OrganizeReport {
	    succeeded: ReportItem[];
	    skipped: ReportItem[];
	    failed: ReportItem[];
	    suggestedWorkdirs?: SuggestedWorkdir[];
	
	    static createFrom(source: any = {}) {
	        return new OrganizeReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.succeeded = this.convertValues(source["succeeded"], ReportItem);
	        this.skipped = this.convertValues(source["skipped"], ReportItem);
	        this.failed = this.convertValues(source["failed"], ReportItem);
	        this.suggestedWorkdirs = this.convertValues(source["suggestedWorkdirs"], SuggestedWorkdir);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class RestoreOrphanItem {
	    linkPath: string;
	    targetPath: string;
	    skillId: string;
	
	    static createFrom(source: any = {}) {
	        return new RestoreOrphanItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.linkPath = source["linkPath"];
	        this.targetPath = source["targetPath"];
	        this.skillId = source["skillId"];
	    }
	}
	export class RestoreOrphanReport {
	    succeeded: ReportItem[];
	    skipped: ReportItem[];
	    failed: ReportItem[];
	
	    static createFrom(source: any = {}) {
	        return new RestoreOrphanReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.succeeded = this.convertValues(source["succeeded"], ReportItem);
	        this.skipped = this.convertValues(source["skipped"], ReportItem);
	        this.failed = this.convertValues(source["failed"], ReportItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SkillLocation {
	    toolId: string;
	    path: string;
	    kind: string;
	    linkTarget?: string;
	
	    static createFrom(source: any = {}) {
	        return new SkillLocation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.toolId = source["toolId"];
	        this.path = source["path"];
	        this.kind = source["kind"];
	        this.linkTarget = source["linkTarget"];
	    }
	}
	export class SkillEntry {
	    id: string;
	    name: string;
	    description?: string;
	    group?: string;
	    hubPath?: string;
	    status: string;
	    locations: SkillLocation[];
	    defaultLanguage?: string;
	    translationCount?: number;
	
	    static createFrom(source: any = {}) {
	        return new SkillEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.group = source["group"];
	        this.hubPath = source["hubPath"];
	        this.status = source["status"];
	        this.locations = this.convertValues(source["locations"], SkillLocation);
	        this.defaultLanguage = source["defaultLanguage"];
	        this.translationCount = source["translationCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SkillI18nInfo {
	    defaultLanguage: string;
	    languages: string[];
	    translationCount: number;
	
	    static createFrom(source: any = {}) {
	        return new SkillI18nInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultLanguage = source["defaultLanguage"];
	        this.languages = source["languages"];
	        this.translationCount = source["translationCount"];
	    }
	}
	
	export class SkillUsageItem {
	    id: string;
	    name: string;
	    count: number;
	    lastUsedAt?: string;
	    daily: Record<string, number>;
	
	    static createFrom(source: any = {}) {
	        return new SkillUsageItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.count = source["count"];
	        this.lastUsedAt = source["lastUsedAt"];
	        this.daily = source["daily"];
	    }
	}
	export class SkillUsageSummary {
	    skills: SkillUsageItem[];
	    hasAnyRecord: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SkillUsageSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skills = this.convertValues(source["skills"], SkillUsageItem);
	        this.hasAnyRecord = source["hasAnyRecord"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SkillVersionRef {
	    id: string;
	    language: string;
	
	    static createFrom(source: any = {}) {
	        return new SkillVersionRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.language = source["language"];
	    }
	}
	
	
	export class TrashItem {
	    id: string;
	    name: string;
	    trashPath: string;
	    deletedAt: string;
	    expiresAt: string;
	
	    static createFrom(source: any = {}) {
	        return new TrashItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.trashPath = source["trashPath"];
	        this.deletedAt = source["deletedAt"];
	        this.expiresAt = source["expiresAt"];
	    }
	}

}

