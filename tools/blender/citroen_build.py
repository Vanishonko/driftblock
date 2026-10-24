"""Build the Driftblock Citroen C5 Tourer game asset from the Sketchfab ZIP.

    blender -b --factory-startup --python tools/blender/citroen_build.py

The source ``citroen-c5-sedan-and-estate.zip`` contains two complete cars side by
side.  This script keeps only ``Citroen_C5_Tourer_2011`` (the estate the game
wants), normalises it to metres with the wheelbase centred on the origin, splits
the four wheels onto steer/spin pivots, decimates it for real-time rendering and
writes ``assets/mods/citroen-c5/citroen-c5-tourer-game.glb``.

The source ZIP is never modified.  The generated GLB is the only asset the game
loads, so the game itself has no build step.

COORDINATES
-----------
Blender is Z-up after the glTF import.  The car's glTF +X (left) stays Blender
+X, glTF +Z (forward) becomes Blender -Y and glTF +Y (up) becomes Blender +Z.
The exporter converts back to Y-up, so the game receives:
    left = +X, forward = +Z, up = +Y
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ZIP = ROOT / "citroen-c5-sedan-and-estate.zip"
OUTPUT = ROOT / "assets" / "mods" / "citroen-c5" / "citroen-c5-tourer-game.glb"

BODY_KEEP = "Tourer"
BODY_DROP = "Saloon"
BODY_NAME = "BODY_TOURER"

# Material-name prefixes.  The source exports material names with numeric
# suffixes per car (e.g. tire.134), so prefix matching is deliberate.
WHEEL_MATERIALS = ("tire", "rim", "brakedisk", "mattemetal")

BODY_DECIMATE = 0.35
WHEEL_DECIMATE = 0.45
WHEEL_SPLIT_X = 0.18   # half the tyre width, plus a little breathing room
WHEEL_SPLIT_YZ = 0.39  # tyre radius (0.345 m) plus margin

CORNERS = ("FL", "FR", "RL", "RR")


def log(message: str) -> None:
    print(f"[citroen] {message}", flush=True)


def read_glb_json(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError(f"{path} is too small to be a GLB")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError(f"{path} is not a glTF 2.0 GLB")
    json_len, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        raise ValueError(f"{path} has no JSON chunk")
    return json.loads(data[20:20 + json_len])


def mesh_array(obj, attribute: str, width: int) -> np.ndarray:
    """Read a per-vertex or per-polygon attribute into a numpy array."""
    me = obj.data
    if attribute == "material_index":
        arr = np.empty(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get(attribute, arr)
        return arr
    count = len(me.vertices) if attribute == "co" else len(me.polygons)
    arr = np.empty(count * width, dtype=np.float32)
    me.vertices.foreach_get(attribute, arr) if attribute == "co" else \
        me.polygons.foreach_get(attribute, arr)
    return arr.reshape(count, width)


def mesh_bounds(obj) -> tuple[np.ndarray, np.ndarray]:
    co = mesh_array(obj, "co", 3)
    return co.min(axis=0), co.max(axis=0)


def slot_indices(obj, prefixes: tuple[str, ...]) -> set[int]:
    out = set()
    for i, slot in enumerate(obj.material_slots):
        mat = slot.material
        if mat and mat.name.lower().startswith(prefixes):
            out.add(i)
    return out


def material_name(obj, slot_index: int) -> str:
    mat = obj.material_slots[slot_index].material if slot_index < len(obj.material_slots) else None
    return mat.name if mat else ""


def tire_centres(obj) -> dict[str, np.ndarray]:
    """Find the four tyre cluster centres from the tyre-material faces."""
    me = obj.data
    tire_slots = slot_indices(obj, ("tire",))
    if not tire_slots:
        raise RuntimeError("no tyre material found on the Tourer")

    mats = mesh_array(obj, "material_index", 1).reshape(-1)
    centres = mesh_array(obj, "center", 3)
    pts = centres[np.isin(mats, sorted(tire_slots))]
    if len(pts) < 4:
        raise RuntimeError("not enough tyre geometry to find the wheels")

    out: dict[str, np.ndarray] = {}
    # The imported object still carries the source node translation, so split
    # on the middle of the tyre extent rather than on world zero.
    x_mid = (pts[:, 0].min() + pts[:, 0].max()) * 0.5
    y_mid = (pts[:, 1].min() + pts[:, 1].max()) * 0.5
    for x_side in (True, False):
        for y_side in (True, False):
            q = pts[
                ((pts[:, 0] >= x_mid) == x_side)
                & ((pts[:, 1] >= y_mid) == y_side)
            ]
            if len(q) == 0:
                continue
            lo = q.min(axis=0)
            hi = q.max(axis=0)
            centre = (lo + hi) * 0.5
            # Blender -Y is the car's forward axis; +X is the left side.
            corner = ("R" if y_side else "F") + ("L" if x_side else "R")
            out[corner] = centre
    if set(out) != set(CORNERS):
        raise RuntimeError(f"expected four tyre clusters, found {sorted(out)}")
    return out


def centre_and_ground(obj) -> None:
    """Move the mesh so the wheelbase midpoint is at the origin and tyres touch Z=0."""
    centres = tire_centres(obj)
    x_centre = float(np.mean([c[0] for c in centres.values()]))
    y_mid = float(np.mean([c[1] for c in centres.values()]))
    lo, _hi = mesh_bounds(obj)
    ground = float(lo[2])
    log(f"normalising: x {x_centre:+.3f}  wheelbase-mid {y_mid:+.3f}  ground {ground:+.3f}")
    obj.data.transform(Matrix.Translation((-x_centre, -y_mid, -ground)))


def select_wheel_faces(obj, centre: np.ndarray) -> list[int]:
    """Select the wheel-material faces inside one wheel's bounding box.

    Returns the material slots used so the caller can sanity-check the split.
    """
    # The previous separation may have left the new wheel active, so make
    # absolutely sure the body is the edit-mode object.
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    me = obj.data
    mats = mesh_array(obj, "material_index", 1).reshape(-1)
    centres = mesh_array(obj, "center", 3)
    slots = slot_indices(obj, WHEEL_MATERIALS)
    if not slots:
        raise RuntimeError("no wheel materials found on the Tourer")

    mask = (
        np.isin(mats, sorted(slots))
        & (np.abs(centres[:, 0] - centre[0]) <= WHEEL_SPLIT_X)
        & (np.abs(centres[:, 1] - centre[1]) <= WHEEL_SPLIT_YZ)
        & (np.abs(centres[:, 2] - centre[2]) <= WHEEL_SPLIT_YZ)
    )
    count = int(mask.sum())
    if count == 0:
        raise RuntimeError(f"no wheel faces found near {centre}")

    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bm = bmesh.from_edit_mesh(me)
    bm.faces.ensure_lookup_table()
    for i, face in enumerate(bm.faces):
        if not mask[i]:
            continue
        face.select = True
        for vert in face.verts:
            vert.select = True
        for edge in face.edges:
            edge.select = True
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    return sorted(slots)


def make_empty(name: str, location: np.ndarray):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=tuple(float(v) for v in location))
    obj = bpy.context.object
    obj.name = name
    obj.empty_display_size = 0.08
    return obj


def parent_keep(child, parent) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    child.select_set(True)
    parent.select_set(True)
    bpy.context.view_layer.objects.active = parent
    bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)


def set_origin(obj, location: np.ndarray) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.scene.cursor.location = tuple(float(v) for v in location)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def decimate(obj, ratio: float) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.ratio = ratio
    before = len(obj.data.polygons)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"decimated {obj.name}: {before} -> {len(obj.data.polygons)} faces (ratio {ratio})")


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_source() -> None:
    if not SOURCE_ZIP.exists():
        raise SystemExit(
            f"missing source archive: {SOURCE_ZIP}\n"
            "Put the supplied citroen-c5-sedan-and-estate.zip in the project root."
        )
    with tempfile.TemporaryDirectory(prefix="citroen-c5-") as tmp:
        with zipfile.ZipFile(SOURCE_ZIP) as zf:
            members = [n for n in zf.namelist() if n.lower().endswith(".glb")]
            if not members:
                raise SystemExit(f"no .glb inside {SOURCE_ZIP}")
            member = members[0]
            source = Path(tmp) / "source.glb"
            source.write_bytes(zf.read(member))
            log(f"importing {member} ({source.stat().st_size / 1e6:.1f} MB)")
            bpy.ops.import_scene.gltf(filepath=str(source))


def main() -> None:
    clear_scene()
    import_source()

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    keep = [o for o in meshes if BODY_KEEP.lower() in o.name.lower()]
    drop = [o for o in meshes if BODY_DROP.lower() in o.name.lower()]
    if len(keep) != 1:
        raise SystemExit(f"expected one {BODY_KEEP} mesh, found {[o.name for o in keep]}")
    body = keep[0]
    log(f"keeping {body.name}; removing {[o.name for o in drop]} and everything else")

    for obj in list(bpy.data.objects):
        if obj is not body:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Clear parents if the importer made a hierarchy, then bake the source
    # translation (-110 m for the other car) and the centimetre scale.
    if body.parent:
        world = body.matrix_world.copy()
        body.parent = None
        body.matrix_world = world
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    body.scale = (0.01, 0.01, 0.01)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    body.name = BODY_NAME

    centre_and_ground(body)
    centres = tire_centres(body)
    log("wheel centres (m): " + ", ".join(
        f"{corner}=({c[0]:+.3f},{c[1]:+.3f},{c[2]:+.3f})" for corner, c in sorted(centres.items())
    ))

    lo, hi = mesh_bounds(body)
    log(f"body bounds: {np.round(lo, 3)} .. {np.round(hi, 3)}")

    # Split the four wheels off the body.  Each separated object inherits the
    # body's material slots; the faces inside one wheel box are its wheel.
    wheels = {}
    for corner in CORNERS:
        centre = centres[corner].copy()
        before = set(bpy.data.objects)
        select_wheel_faces(body, centre)
        new_objects = [o for o in bpy.data.objects if o not in before]
        if len(new_objects) != 1:
            raise RuntimeError(f"{corner}: separation produced {len(new_objects)} objects")
        wheel = new_objects[0]
        wheel.name = f"WHEEL_MERGED_{corner}"
        set_origin(wheel, centre)
        if (wheel.location - Vector(centre)).length > 1e-4:
            raise RuntimeError(f"{corner}: origin did not land on the wheel centre")
        wheels[corner] = wheel
        log(f"{corner}: {len(wheel.data.polygons)} faces at {np.round(centre, 3)}")

    # Steer -> spin -> wheel.  The empties carry the wheel centre; the game
    # rotates WHEEL_STEER_* around Y and WHEEL_SPIN_* around X.
    pivots = {}
    for corner in CORNERS:
        centre = centres[corner]
        steer = make_empty(f"WHEEL_STEER_{corner}", centre)
        spin = make_empty(f"WHEEL_SPIN_{corner}", centre)
        parent_keep(spin, steer)
        parent_keep(wheels[corner], spin)
        pivots[corner] = (steer, spin)
        if (spin.matrix_world.translation - steer.matrix_world.translation).length > 1e-4:
            raise RuntimeError(f"{corner}: spin pivot is not on the steer pivot")

    decimate(body, BODY_DECIMATE)
    for corner in CORNERS:
        decimate(wheels[corner], WHEEL_DECIMATE)

    # Drop empty material slots.  Wheel materials can stay on the body even
    # though their faces are gone; only the polygons matter for the export.
    for obj in [body] + [wheels[c] for c in CORNERS]:
        for i in range(len(obj.material_slots) - 1, -1, -1):
            if obj.material_slots[i].material is None:
                obj.data.materials.pop(index=i)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    export_objects = [body] + [wheels[c] for c in CORNERS]
    for corner in CORNERS:
        export_objects.extend(pivots[corner])
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body

    log(f"exporting {OUTPUT.relative_to(ROOT)}")
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_draco_mesh_compression_enable=False,
    )

    # Validate the shipped file: it must contain the Tourer and never the
    # Saloon, and the four wheel pivots must be present by name.
    j = read_glb_json(OUTPUT)
    nodes = {n.get("name", "") for n in j.get("nodes", [])}
    meshes = [m.get("name", "") for m in j.get("meshes", [])]
    log(f"GLB: {OUTPUT.stat().st_size / 1e6:.2f} MB, {len(j.get('nodes', []))} nodes, {len(meshes)} meshes")
    log("nodes: " + ", ".join(sorted(nodes)))
    if any(BODY_DROP.lower() in n.lower() for n in list(nodes) + meshes):
        raise SystemExit("the Saloon leaked into the exported GLB")
    for corner in CORNERS:
        for name in (f"WHEEL_STEER_{corner}", f"WHEEL_SPIN_{corner}", f"WHEEL_MERGED_{corner}"):
            if name not in nodes:
                raise SystemExit(f"missing node {name} in exported GLB")
    tris = 0
    for mesh in j.get("meshes", []):
        for prim in mesh.get("primitives", []):
            idx = prim.get("indices")
            if idx is not None:
                tris += j["accessors"][idx]["count"] // 3
    log(f"triangles: {tris:,}")
    log("done")


if __name__ == "__main__":
    main()
