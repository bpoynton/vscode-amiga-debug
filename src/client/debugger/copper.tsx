import { Fragment, FunctionComponent, h, JSX } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../styles.css';
import styles from './copper.module.css';

import { IProfileModel } from '../model';
declare const MODEL: IProfileModel;

import { CopperDisassembler } from '../copperDisassembler';
import { CustomRegisters } from '../customRegisters';
import { GetCopper, GetMemoryAfterDma, GetPaletteFromCustomRegs, IScreen, GetScreenFromCopper, GetPaletteFromMemory as GetPaletteFromMemory, GetPaletteFromCopper } from '../dma';
import { GfxResourceType, GfxResource, GfxResourceFlags } from '../../backend/profile_types';
import { createPortal } from 'preact/compat';

import { DropdownComponent, DropdownOptionProps } from '../dropdown';
import '../dropdown.css';

export const Screen: FunctionComponent<{
	screen: IScreen;
	mask?: IScreen;
	palette: number[];
	scale?: number;
	useZoom?: boolean;
}> = ({ screen, mask, palette, scale = 2, useZoom = true }) => {
	const canvas = useRef<HTMLCanvasElement>();
	const canvasScale = scale;
	const canvasWidth = screen.width * canvasScale;
	const canvasHeight = screen.height * canvasScale;

	const zoomDiv = useRef<HTMLDivElement>();
	const zoomCanvas = useRef<HTMLCanvasElement>();
	const zoomCanvasScale = 8;
	const zoomCanvasWidth = 144;
	const zoomCanvasHeight = 144;

	interface ZoomInfo {
		x?: number;
		y?: number;
		color?: number;
		mask?: number;
	}
	const [zoomInfo, setZoomInfo] = useState<ZoomInfo>({});

	const memory = MODEL.memory; //GetChipMemAfterDma(model.chipMemCache, model.dmaRecords, 0xffffffff); // end-of-frame for now

	const getPixel = useMemo(() => (scr: IScreen, x: number, y: number): number => {
		let pixel = 0;
		for(let p = 0; p < scr.planes.length; p++) {
			const addr = scr.planes[p] + y * (scr.width / 8 + scr.modulos[p & 1]) + Math.floor(x / 8);
			const raw = memory.readByte(addr);
			if(raw & (1 << (7 - (x & 7))))
				pixel |= 1 << p;
		}
		return pixel;
	}, [memory]);

	useEffect(() => {
		const context = canvas.current?.getContext('2d');
		const imgData = context.createImageData(canvasWidth, canvasHeight);
		const data = new Uint32Array(imgData.data.buffer);
		const putPixel = (x: number, y: number, color: number) => {
			for(let yy = 0; yy < canvasScale; yy++) {
				for(let xx = 0; xx < canvasScale; xx++) {
					const offset = (((y * canvasScale + yy) * canvasWidth) + x * canvasScale + xx);
					data[offset] = color;
				}
			}
		};
		const planes = [...screen.planes];
		const maskPlanes = [...mask?.planes ?? []];
		for(let y = 0; y < screen.height; y++) {
			for(let x = 0; x < screen.width / 16; x++) {
				for(let i = 0; i < 16; i++) {
					let pixel = 0;
					let pixelMask = 0xffff;
					for(let p = 0; p < planes.length; p++) {
						const addr = planes[p] + x * 2;
						const raw = memory.readWord(addr);
						if((raw & (1 << (15 - i))))
							pixel |= 1 << p;
					}
					if(mask) {
						for(let p = 0; p < maskPlanes.length; p++) {
							const addr = maskPlanes[p] + x * 2;
							const raw = memory.readWord(addr);
							if((raw & (1 << (15 - i))))
								pixelMask |= 1 << p;
						}
						pixel &= pixelMask;
						putPixel(x * 16 + i, y, pixel ? palette[pixel] : 0); // color 0 is transparent
					} else {
						putPixel(x * 16 + i, y, palette[pixel]);
					}
				}
			}
			for(let p = 0; p < planes.length; p++) {
				planes[p] += screen.width / 8 + screen.modulos[p & 1];
			}
			if(mask) {
				for(let p = 0; p < maskPlanes.length; p++) {
					maskPlanes[p] += mask.width / 8 + mask.modulos[p & 1];
				}
			}
		}
		context.putImageData(imgData, 0, 0);
	}, [canvas.current, scale, screen, mask]);

	const onMouseMove = useCallback(
		(evt: MouseEvent) => {
			if(!useZoom)
				return;
			const snap = (p: number) => Math.floor(p / canvasScale) * canvasScale;
			const context = zoomCanvas.current?.getContext('2d');
			context.imageSmoothingEnabled = false;
			context.clearRect(0, 0, zoomCanvasWidth, zoomCanvasHeight);
			const srcWidth = zoomCanvasWidth / zoomCanvasScale;
			const srcHeight = zoomCanvasHeight / zoomCanvasScale;
			context.drawImage(canvas.current, snap(evt.offsetX) - srcWidth / 2, snap(evt.offsetY) - srcHeight / 2, srcWidth, srcHeight, 0, 0, zoomCanvasWidth, zoomCanvasHeight);
			context.lineWidth = 2;
			context.strokeStyle = 'rgba(0,0,0,1)';
			context.strokeRect((zoomCanvasWidth - zoomCanvasScale * canvasScale) / 2 + zoomCanvasScale, (zoomCanvasHeight - zoomCanvasScale * canvasScale) / 2 + zoomCanvasScale, zoomCanvasScale * canvasScale, zoomCanvasScale * canvasScale);
			context.strokeStyle = 'rgba(255,255,255,1)';
			context.strokeRect((zoomCanvasWidth - zoomCanvasScale * canvasScale) / 2 + zoomCanvasScale - 2, (zoomCanvasHeight - zoomCanvasScale * canvasScale) / 2 + zoomCanvasScale - 2, zoomCanvasScale * canvasScale + 4, zoomCanvasScale * canvasScale + 4);
			const srcX = Math.floor(evt.offsetX / canvasScale);
			const srcY = Math.floor(evt.offsetY / canvasScale);
			setZoomInfo({ x: srcX, y: srcY, color: getPixel(screen, srcX, srcY), mask: mask ? getPixel(mask, srcX, srcY) : undefined });

			// position zoomCanvas
			zoomDiv.current.style.top = snap(evt.offsetY) + 10 + "px";
			zoomDiv.current.style.left = snap(evt.offsetX) + 10 + "px";
			zoomDiv.current.style.display = 'block';
		}, [canvas.current, zoomCanvas.current, scale, screen, mask, useZoom]);

	const onMouseLeave = useCallback((evt: MouseEvent) => {
		if(!useZoom)
			return;
		zoomDiv.current.style.display = 'none';
	}, [useZoom, zoomDiv.current]);

	return (
		<div class={styles.screen}>
			<canvas ref={canvas} width={canvasWidth} height={canvasHeight} class={styles.screen} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} />
			{useZoom && <div ref={zoomDiv} class={styles.zoom} style={{ display: 'none' }}>
				<canvas ref={zoomCanvas} width={zoomCanvasWidth} height={zoomCanvasHeight} />
				{zoomInfo.color !== undefined && (<div>
					<dl>
						<dt>Pos</dt>
						<dd>X:{zoomInfo.x} Y:{zoomInfo.y}</dd>
						<dt>Color</dt>
						<dd>{zoomInfo.color} ${zoomInfo.color.toString(16).padStart(2, '0')} %{zoomInfo.color.toString(2).padStart(screen.planes.length, '0')}</dd>
						{mask !== undefined && zoomInfo.mask !== undefined && (<Fragment>
							<dt>Mask</dt>
							<dd>{zoomInfo.mask} ${zoomInfo.mask.toString(16).padStart(2, '0')} %{zoomInfo.mask.toString(2).padStart(mask.planes.length, '0')}</dd>
						</Fragment>)}
					</dl>
				</div>)}
			</div>}
		</div>
	);
};

interface GfxResourceWithPayload {
	resource: GfxResource;
	screen?: IScreen;
	mask?: IScreen;
	palette?: number[];
}

const GfxResourceItem: FunctionComponent<DropdownOptionProps<GfxResourceWithPayload>> = ({ option, placeholder }) => {
	const resource = option.resource;

	const [hover, setHover] = useState<{ x: number, y: number }>({ x: -1, y: -1 });

	const onMouseEnter = (evt: JSX.TargetedMouseEvent<HTMLDivElement>) => {
		const rect = evt.currentTarget.getBoundingClientRect();
		setHover({ x: rect.right + 10, y: rect.top });
	};
	const onMouseLeave = () => {
		setHover({ x: -1, y: -1});
	};

	return (<Fragment>
		<div class={placeholder ? styles.gfxresource_brief : styles.gfxresource} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
			<dt>{resource.name}</dt>
			<dd>
				{resource.type === GfxResourceType.bitmap && (<Fragment>
					{resource.bitmap.width}x{resource.bitmap.height}x{resource.bitmap.numPlanes}
					&nbsp;
					{resource.flags & GfxResourceFlags.bitmap_interleaved ? 'I' : ''}
					{resource.flags & GfxResourceFlags.bitmap_masked ? 'M' : ''}
				</Fragment>)}
				{resource.type === GfxResourceType.palette && (<Fragment>
					<div class={styles.palette}>
						{option.palette.map((p) => <div style={{backgroundColor: `#${(p & 0xffffff).toString(16).padStart(6, '0')}`}} />)}
					</div>
				</Fragment>)}
			</dd>
			<dd class={styles.right}>{resource.size ? (resource.size.toLocaleString(undefined, { maximumFractionDigits: 0 }) + 'b') : ''}</dd>
			<dd class={styles.fixed}>{resource.address ? ('$' + resource.address.toString(16).padStart(8, '0')) : ''}</dd>
		</div>
		{(!placeholder && hover.x >= 0 && resource.type === GfxResourceType.bitmap) && createPortal(<div class={styles.tooltip} style={{ lineHeight: 0, left: hover.x, top: hover.y, bottom: 'initial' }}>
			<Screen screen={option.screen} palette={GetPaletteFromCustomRegs(new Uint16Array(MODEL.amiga.customRegs))} scale={1} useZoom={false} />
		</div>, document.body)}
	</Fragment>);
};

// do not move into 'CopperList' otherwise the Dropdown will be recreated on every render
class GfxResourceDropdown extends DropdownComponent<GfxResourceWithPayload> {
	public static defaultProps = { optionComponent: GfxResourceItem, menuClassName: styles.gfxresource_menu, ...DropdownComponent.defaultProps };
}

export const CopperList: FunctionComponent<{}> = ({ }) => {
	const copper = useMemo(() => GetCopper(MODEL.memory.chipMem, MODEL.amiga.dmaRecords), [MODEL]);
	const bitmaps = useMemo(() => {
		const bitmaps: GfxResourceWithPayload[] = [];
		MODEL.amiga.gfxResources.filter((r) => r.type === GfxResourceType.bitmap).sort((a, b) => a.name.localeCompare(b.name)).forEach((resource) => {
			const width = resource.bitmap.width;
			const height = resource.bitmap.height;
			const modulos = [];
			const planes = [];
			if(resource.flags & GfxResourceFlags.bitmap_interleaved) {
				const moduloScale = (resource.flags & GfxResourceFlags.bitmap_masked) ? 2 : 1;
				for(let p = 0; p < resource.bitmap.numPlanes; p++)
					planes.push(resource.address + p * width / 8 * moduloScale);
				const modulo = (width / 8) * (resource.bitmap.numPlanes * moduloScale - 1);
				modulos.push(modulo, modulo);
			} else {
				for(let p = 0; p < resource.bitmap.numPlanes; p++)
					planes.push(resource.address + p * width / 8 * height);
				modulos.push(0, 0);
			}
			const screen: IScreen = { width, height, planes, modulos };
			let mask: IScreen;
			if(resource.flags & GfxResourceFlags.bitmap_masked) {
				const maskPlanes = [...planes];
				if(resource.flags & GfxResourceFlags.bitmap_interleaved) {
					for(let p = 0; p < resource.bitmap.numPlanes; p++)
						maskPlanes[p] += width / 8;
				} else {
					// ??? does this make sense ?? not tested
					for(let p = 0; p < resource.bitmap.numPlanes; p++)
						maskPlanes[p] += width / 8 * height;
				}
				mask = { width, height, planes: maskPlanes, modulos };
			}
			bitmaps.push({ resource, screen, mask });
		});
		const copperScreen = GetScreenFromCopper(copper);
		const copperResource: GfxResource = {
			address: copperScreen.planes[0],
			size: 0,
			name: '*Copper*',
			type: GfxResourceType.bitmap,
			flags: 0,
			bitmap: {
				width: copperScreen.width,
				height: copperScreen.height,
				numPlanes: copperScreen.planes.length
			}
		};
		bitmaps.unshift({ resource: copperResource, screen: copperScreen });
		return bitmaps;
	}, [MODEL]);

	const palettes = useMemo(() => {
		const palettes: GfxResourceWithPayload[] = [];

		const copperPalette = GetPaletteFromCopper(copper);
		const copperResource: GfxResource = {
			address: 0, // TODO
			size: 32*2,
			name: '*Copper*',
			type: GfxResourceType.palette,
			flags: 0,
			palette: {
				numEntries: copperPalette.length
			}
		};
		palettes.push({ resource: copperResource, palette: copperPalette });

		const customRegsPalette = GetPaletteFromCustomRegs(new Uint16Array(MODEL.amiga.customRegs));
		const customRegsResource: GfxResource = {
			address: CustomRegisters.getCustomAddress("COLOR00"),
			size: 32*2,
			name: '*Custom Registers*',
			type: GfxResourceType.palette,
			flags: 0,
			palette: {
				numEntries: 32
			}
		};
		palettes.push({ resource: customRegsResource, palette: customRegsPalette });

		MODEL.amiga.gfxResources.filter((r) => r.type === GfxResourceType.palette).sort((a, b) => a.name.localeCompare(b.name)).forEach((resource) => {
			const palette = GetPaletteFromMemory(MODEL.memory, resource.address, resource.palette.numEntries);
			palettes.push({ resource, palette });
		});

		return palettes;
	}, [MODEL]);

	const [bitmap, setBitmap] = useState<GfxResourceWithPayload>(bitmaps[0]);
	const [palette, setPalette] = useState<GfxResourceWithPayload>(palettes[0]);
	const onChangeBitmap = (selected: GfxResourceWithPayload) => { setBitmap(selected); };
	const onChangePalette = (selected: GfxResourceWithPayload) => { setPalette(selected); };

	return (<div style={{'font-size': 'var(--vscode-editor-font-size)'}}>
		Bitmap:&nbsp;
		<GfxResourceDropdown options={bitmaps} value={bitmap} onChange={onChangeBitmap} />
		&nbsp;
		Palette:&nbsp;
		<GfxResourceDropdown options={palettes} value={palette} onChange={onChangePalette} />
		<Screen screen={bitmap.screen} mask={bitmap.mask} palette={palette.palette} />

		<div class={styles.container}>
			{copper.map((c) => 'L' + c.vpos.toString().padStart(3, '0') + 'C' + c.hpos.toString().padStart(3, '0') + ' $' + c.address.toString(16).padStart(8, '0') + ': ' + c.insn.toString()).join('\n')}
		</div>
	</div>);
};
