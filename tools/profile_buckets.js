// The routines the profilers attribute time to.
exports.BUCKETS = new Set(["mul_u8","mul_s8_u8","mul_s16_u8","divs","fpmul8","mul_s8_s8",
  "rns_ahl","rns_hl","rns3_ahl","rns8_ahl","ev_at","linfn","pw","pw_diff","sp_alive",
  "sp_hasgap","sp_marksolid","sp_fuse","fu_ge","fu_verdict","ct_bounds","fu_lyext","fu_line","fu_out","fu_okeep","fu_orun","fu_above","sp_begin","sp_commit","pw_diff","pw_evd","sp_emit_range","sp_emit_range2","flush_edges","ct_span","ct_edge","queue_edge","sp_drawv","cross_col","cl_apply",
  "cl_at","cl_clampx","cl_clampy","to_view","rot_sin","rot_cos","recip","project_x",
  "project_y","view_setup","bbox_range","bb_edge","near_cross","vertex_get","vg_cold","vg_project","vx_slot","rs_near","near_cross_seg1","near_cross_seg2","rs_clip1","rs_clip2","rs_clipx","rs_do2","near_cross","sat_ahl",
  "point_on_side","render_seg","rs_visible","rs_havex","rs_bf_x0","rs_bf_y0","render_seg_body","rsb_p2","rsb_tighten","rsb_solid","walk","sp_emit","sp_commit","cmp_s16",
  "sincos_lookup","div16_8","dl_emit","dl_render","plot_line","raster_clear","sp_reset",
  "ptoa","ptoa_memo","bb_corner_angle","bb_angtox","walk_child","walk_ss","emit_edge","mul_u8","plot_vert","addr_of","find_eye_height","update_world_pos","view_setup"]);
