//@ts-ignore
import * as deepAssign from 'assign-deep'
import { ZipEntry } from 'node-stream-zip'
import { destroyRenderer, prepareRenderer, render } from './render'
import { Jar } from './utils/jar'
import type { AnimationMeta, BlockModel, BlockState, BlockStateVariant, Renderer, RendererOptions } from './utils/types'
import * as libpath from 'path';
import { stat } from 'fs'

export class Minecraft {
	protected jar: Jar
	protected renderer!: Renderer | null
	protected _cache: { [key: string]: any } = {}
	protected _modid_jars : { [key: string]: Jar } = {}

	/**
	 * Construct the Minecraft instance
	 * 
	 * @author   Jelle De Loecker   <jelle@elevenways.be>
	 * @since    1.2.0
	 * @version  1.2.0
	 * 
	 * @param   file        The path to the jar, or the jar itself
	 * @param   namespace   The default namespace used in thie jar
	 */
	protected constructor(public file: string | Jar, protected readonly defaultNamespace = 'minecraft') {
		if (file instanceof Jar) {
			this.jar = file
		} else {
			this.jar = Jar.open(file)
		}
	}

	/**
	 * Create a new instance
	 */
	static open(file: string | Jar, namespace?: string) {
		return new Minecraft(file, namespace)
	}

	/**
	 * Create an identifier
	 */
	protected id(name: string) {
		if (name.includes(':')) {
			const [namespace, id] = name.split(':')
			return { namespace, id }
		} else {
			return { namespace: 'minecraft', id: name }
		}
	}

	/**
	 * Register other jars
	 * 
	 * @author   Jelle De Loecker   <jelle@elevenways.be>
	 * @since    1.2.0
	 * @version  1.2.0
	 * 
	 * @param   modid   The modid of the other jar
	 * @param   path    The path of the other jar
	 *
	 * @return  The opened jar
	 */
	async registerModId(modid: string, path : string | Jar) : Promise<Jar> {

		let jar;

		if (typeof path == 'string') {
			jar = Jar.open(path);
		} else {
			jar = path;
		}

		this._modid_jars[modid] = jar;

		return jar;
	}

	/**
	 * Get a file from any of the registered jars
	 * 
	 * @author   Jelle De Loecker   <jelle@elevenways.be>
	 * @since    1.2.0
	 * @version  1.2.0
	 * 
	 * @param    path    The path of the file to read
	 */
	async getFile(path : string) : Promise<Buffer | null> {

		let result;

		// Try our jar first
		try {
			result = await this.jar.read(path);
		} catch (err) {
			// Ignore
		}

		if (result) {
			return result;
		}

		for (let key in this._modid_jars) {
			let jar = this._modid_jars[key];

			try {
				result = await jar.read(path);
			} catch (err) {
				continue;
			}

			if (result) {
				return result;
			}
		}

		return null;
	}

	/**
	 * Get all the entries of a directory
	 * 
	 * @author   Jelle De Loecker   <jelle@elevenways.be>
	 * @since    1.2.0
	 * @version  1.2.0
	 * 
	 * @param    path    The path of the file to read
	 */
	 async getFileEntries(path : string) : Promise<ZipEntry[]> {

		let result : ZipEntry[];

		// Try the main jar first
		try {
			result = await this.jar.entries(path);
		} catch(err) {
			// Ignore
			result = [];
		}

		if (result && result.length) {
			return result;
		}

		for (let key in this._modid_jars) {
			let jar = this._modid_jars[key];

			try {
				result = await jar.entries(path);
			} catch (err) {
				continue;
			}

			if (result && result.length) {
				return result;
			}
		}

		return [];
	 }

	/**
	 * Get json data from any of the registered jars
	 * 
	 * @author   Jelle De Loecker   <jelle@elevenways.be>
	 * @since    1.2.0
	 * @version  1.2.0
	 * 
	 * @param    path    The path of the file to read
	 */
	async getParsedJson(path : string) : Promise<any> {

		if (!this._cache[path]) {
			let data = await this.getFile(path);

			if (data) {
				this._cache[path] = this.parseJson(data);
			}
		}

		if (this._cache[path]) {
			return this.clone(this._cache[path]);
		}
	 }

	/**
	 * Parse or clone json data
	 * 
	 * @author   Jelle De Loecker   <jelle@elevenways.be>
	 * @since    1.2.0
	 * @version  1.2.0
	 * 
	 * @param    path    The path of the file to read
	 */
	public parseJson(data : string | Object | Buffer) : Object | null {

		let str : string;

		if (typeof data == 'object') {

			if (Buffer.isBuffer(data)) {
				str = data.toString('utf8');
			} else {
				str = JSON.stringify(data);
			}
		} else if (typeof data == 'string') {
			str = data;
		} else {
			return null;
		}

		return JSON.parse(str);
	}

	/**
	 * Clone the given input
	 * 
	 * @author   Jelle De Loecker   <jelle@elevenways.be>
	 * @since    1.2.0
	 * @version  1.2.0
	 * 
	 * @param    path    The path of the file to read
	 */
	public clone<T>(input : T) : T {
		return JSON.parse(JSON.stringify(input));
	}

	/**
	 * Get a list of all the blockstates
	 */
	async getBlockStates(namespace = this.defaultNamespace): Promise<BlockState[]> {

		let files = await this.getFileEntries(`assets/${namespace}/blockstates`),
		    states = [];
		
		for(let file of files) {

			if (!file.name.endsWith('.json')) {
				continue;
			}

			let filename = libpath.basename(file.name).slice(0, -5);

			let state = <BlockState> await this.getParsedJson(file.name);
			state.identifier = namespace + ':' + filename;

			states.push(state);
		}

		return states;
	}

	/**
	 * Get a specific blockstate
	 */
	async getBlockState(identifier : string): Promise<BlockState | undefined> {

		let blockstates = await this.getBlockStates();

		for (const state of blockstates) {
			if (state.identifier == identifier) {
				return state;
			}
		}
	}

	/**
	 * Get a list of all the blockname models
	 */
	async getBlockNameList(namespace = this.defaultNamespace): Promise<string[]> {

		let states = await this.getBlockStates(namespace);
		let result = [];

		for (let state of states) {
			if (!state.identifier) continue;
			result.push(state.identifier);
		}

		return result;
	}

	/**
	 * Get a list of all blocks of the given namespace
	 */
	async getBlockList(namespace = this.defaultNamespace): Promise<BlockModel[]> {

		let result = [],
		    promises = [],
			promise,
		    states = await this.getBlockStates(namespace),
		    state,
			i;
		
		for (state of states) {
			promises.push(this.getModelFromBlockState(state));
		}

		promises = await Promise.allSettled(promises);

		for (promise of promises) {
			if (promise.status == 'fulfilled') {
				if (promise.value) {
					result.push(promise.value);
				}
			}
		}

		return result;
	}

	/**
	 * Get the model of a specific block identifier
	 */
	async getModelOfIdentifier(identifier: string): Promise<BlockModel | undefined> {
		let state = await this.getBlockState(identifier);

		if (state) {
			return this.getModelFromBlockState(state);
		}
	}

	/**
	 * Get the model of a block. Add all the parent info too.
	 */
	async getModel(blockName: string): Promise<BlockModel> {
		let { parent, ...model } = await this.getModelFile(blockName)

		// If no gui data was found, always fallback to regular block settings
		if (!parent && (!model.display || !model.display.gui)) {
			parent = 'minecraft:block/block';
		}

		if (parent) {
			model = deepAssign({}, await this.getModel(parent), model)

			if (!model.parents) {
				model.parents = []
			}

			model.parents.push(parent)
		}

		return deepAssign(model, { blockName })
	}

	/**
	 * Get the model of a block based on its blockstate.
	 * The first blockstate variant is chosen.
	 * Add all the parent info too.
	 */
	 async getModelFromBlockState(block_state: BlockState): Promise<BlockModel | undefined> {

		let default_variant : BlockStateVariant = block_state.variants[''];

		if (!default_variant) {
			for (let key in block_state.variants) {
				default_variant = block_state.variants[key];
				break;
			}
		}

		if (Array.isArray(default_variant)) {
			default_variant = default_variant[0];
		}

		let blockName = default_variant.model;

		let model_file = await this.getModelFile(blockName);

		if (!model_file) {
			console.warn('Failed to find model file named', blockName);
			return;
		}

		let parent = model_file.parent;
		model_file.parent = undefined;

		// If no gui data was found, always fallback to regular block settings
		if (!parent && (!model_file.display || !model_file.display.gui)) {
			parent = 'minecraft:block/block';
		}

		if (parent) {
			model_file = deepAssign({}, await this.getModel(parent), model_file)

			if (!model_file.parents) {
				model_file.parents = []
			}

			model_file.parents.push(parent)
		}

		return deepAssign(model_file, { blockName })
	}

	/**
	 * Get a specific Block model file, without adding parent info.
	 */
	async getModelFile<T = BlockModel>(name = 'block/block'): Promise<T> {
		let { namespace, id } = this.id(name)

		if (id.indexOf('/') == -1) {
			id = `block/${id}`
		}

		const path = `assets/${namespace}/models/${id}.json`

		try {
			return this.getParsedJson(path);
		} catch (e) {
			throw new Error(`Unable to find model file: ${path}`)
		}
	}

	async getTextureFile(name: string = '') {
		const { namespace, id } = this.id(name)

		const path = `assets/${namespace}/textures/${id}.png`

		try {
			return await this.getFile(path)
		} catch (e) {
			throw new Error(`Unable to find texture file: ${path}`)
		}
	}

	async getTextureMetadata(name: string = ''): Promise<AnimationMeta | null> {
		const { namespace, id } = this.id(name)

		const path = `assets/${namespace}/textures/${name}.png.mcmeta`

		try {
			return await this.getParsedJson(path);
		} catch (e) {
			return null
		}
	}

	async *render(blocks: BlockModel[], options?: RendererOptions) {
		try {
			await this.prepareRenderEnvironment(options)

			for (const block of blocks) {
				yield await render(this, block)
			}
		} finally {
			await this.cleanupRenderEnvironment()
		}
	}

	async renderSingle(block: BlockModel) {
		return await render(this, block)
	}

	async close() {
		await this.jar.close()
	}

	async prepareRenderEnvironment(options: RendererOptions = {}) {
		this.renderer = await prepareRenderer(options)
	}

	async cleanupRenderEnvironment() {
		await destroyRenderer(this.renderer!)
		this.renderer = null
	}

	getRenderer() {
		return this.renderer!
	}
}
