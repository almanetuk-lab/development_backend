import { fetchAdminReport } from "../services/reportService.js";
export const getAdminReport = async (req, res) => {
  try {
    let { fromDate, toDate, groupBy = "month" } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "fromDate and toDate are required"
      });
    }

    // end of day fix
    toDate = `${toDate} 23:59:59`;

    const data = await fetchAdminReport(fromDate, toDate, groupBy);

    res.status(200).json({
      success: true,
      message: "Admin report fetched successfully",
      data
    });
  } catch (error) {
    console.error("Admin Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};


