//@ts-ignore
import * as deepAssign from 'assign-deep'
import { destroyRenderer, prepareRenderer, render } from './render'
import { Jar } from './utils/jar'
import type { AnimationMeta, BlockModel, Renderer, RendererOptions } from './utils/types'

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

	static open(file: string | Jar, namespace?: string) {
		return new Minecraft(file, namespace)
	}

	async getBlockNameList(namespace = this.defaultNamespace): Promise<string[]> {
		return (await this.jar.entries(`assets/${namespace}/models/block`))
			.filter(entry => entry.name.endsWith('.json'))
			.map(
				entry =>
					namespace +
					':' +
					entry.name.slice(`assets/${namespace}/models/block/`.length, -'.json'.length)
			)
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
	 */
	async registerModId(modid: string, path : string) {
		this._modid_jars[modid] = Jar.open(path);
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
	 * Get a list of all blocks of the given namespace
	 */
	async getBlockList(namespace = this.defaultNamespace): Promise<BlockModel[]> {
		return await Promise.all(
			(await this.getBlockNameList(namespace)).map(block => this.getModel(block))
		)
	}

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

	async getModel(blockName: string): Promise<BlockModel> {
		let { parent, ...model } = await this.getModelFile(blockName)

		if (parent) {
			model = deepAssign({}, await this.getModel(parent), model)

			if (!model.parents) {
				model.parents = []
			}

			model.parents.push(parent)
		}

		return deepAssign(model, { blockName })
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
