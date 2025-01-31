/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { IPromptFileReference } from '../parsers/types.js';
import { assert } from '../../../../../../base/common/assert.js';
import { dirname } from '../../../../../../base/common/resources.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ObjectCache } from '../../../../../../base/common/objectCache.js';
import { CancellationError } from '../../../../../../base/common/errors.js';
import { TextModelPromptParser } from '../parsers/textModelPromptParser.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../../../services/lifecycle/common/lifecycle.js';
import { PROMPT_SNIPPET_FILE_EXTENSION } from '../contentProviders/promptContentsProviderBase.js';
import { ILanguageFeaturesService } from '../../../../../../editor/common/services/languageFeatures.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../../../common/contributions.js';
import { CompletionContext, CompletionItem, CompletionItemKind, CompletionItemProvider, CompletionList } from '../../../../../../editor/common/languages.js';

/**
 * TODO: @legomushroom
 */
const findFileReference = (
	references: readonly IPromptFileReference[],
	position: Position,
): IPromptFileReference | undefined => {
	for (const reference of references) {
		const { range } = reference;
		if (range.startLineNumber !== position.lineNumber) {
			continue;
		}

		if (range.endColumn !== position.column) {
			continue;
		}

		// TODO: @legomushroom - check that reference is the `#file:` one
		if (reference.type !== 'file') {
			return undefined;
		}

		return reference;
	}

	return undefined;
};

/**
 * TODO: @legomushroom
 */
type TFilesystemCompletionItem = CompletionItem & { kind: CompletionItemKind.File | CompletionItemKind.Folder };

/**
 * TODO: @legomushroom
 */
const getSuggestionsFor = async (
	uri: URI,
	fileReference: IPromptFileReference,
	fileService: IFileService,
): Promise<TFilesystemCompletionItem[]> => {
	const range = {
		...fileReference.range,
		startColumn: fileReference.range.endColumn,
		endColumn: fileReference.range.endColumn,
	};

	const info = await fileService.resolve(dirname(uri));
	const suggestions: TFilesystemCompletionItem[] = [{
		label: '..',
		kind: CompletionItemKind.Folder,
		insertText: '..',
		range,
		sortText: '0',
	}];

	for (const child of info.children || []) {
		const kind = child.isDirectory
			? CompletionItemKind.Folder
			: CompletionItemKind.File;

		const sortText = child.isDirectory
			? '1'
			: '2';

		suggestions.push({
			label: child.name,
			insertText: `./${child.name}`,
			range,
			kind,
			sortText,
		});
	}

	return suggestions;
};

/**
 * Prompt files language selector.
 * TODO: @legomushroom - move to a common constant
 */
const languageSelector = {
	pattern: `**/*${PROMPT_SNIPPET_FILE_EXTENSION}`,
};

/**
 * Provides link references for prompt files.
 */
export class PromptPathAutocompletion extends Disposable implements CompletionItemProvider {
	public readonly _debugDisplayName: string = 'PromptPathAutocompletion';

	public readonly triggerCharacters = [':']; // TODO: @legomushroom - also add the `/` character

	/**
	 * Cache of text model content prompt parsers.
	 */
	private readonly parserProvider: ObjectCache<TextModelPromptParser, ITextModel>;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IInstantiationService private readonly initService: IInstantiationService,
		@ILanguageFeaturesService private readonly languageService: ILanguageFeaturesService,
	) {
		super();

		this.languageService.completionProvider.register(languageSelector, this);
		this.parserProvider = this._register(new ObjectCache(this.createParser.bind(this)));
	}


	public async provideCompletionItems(
		model: ITextModel,
		position: Position,
		context: CompletionContext,
		token: CancellationToken,
	): Promise<CompletionList | undefined> {
		assert(
			!token.isCancellationRequested,
			new CancellationError(),
		);

		const parser = this.parserProvider.get(model);
		assert(
			!parser.disposed,
			'Prompt parser must not be disposed.',
		);

		// start the parser in case it was not started yet,
		// and wait for it to settle to a final result
		const { references } = await parser
			.start()
			.settled();

		// validate that the cancellation was not yet requested
		assert(
			!token.isCancellationRequested,
			new CancellationError(),
		);

		const fileReference = findFileReference(references, position);
		if (!fileReference) {
			return undefined;
		}

		// TODO: @legomushroom - this is only for the `:` completions
		if (fileReference.linkRange !== undefined) {
			return undefined;
		}

		const suggestions = await getSuggestionsFor(model.uri, fileReference, this.fileService);
		return {
			suggestions,
			incomplete: false,
		};
	}

	// TODO: @legomushroom - this should be a part of a common global singleton
	private createParser(
		model: ITextModel,
	): TextModelPromptParser & { disposed: false } {
		const parser: TextModelPromptParser = this.initService.createInstance(
			TextModelPromptParser,
			model,
			[],
		);

		parser.assertNotDisposed(
			'Created prompt parser must not be disposed.',
		);

		return parser;
	}
}

// register the provider as a workbench contribution
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(PromptPathAutocompletion, LifecyclePhase.Eventually);
