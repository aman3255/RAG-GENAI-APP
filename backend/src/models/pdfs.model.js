const mongoose = require("mongoose");

const PdfSchema = new mongoose.Schema({
  // PDF Basic Information
  name: {
    type: String,
    required: [true, "PDF name is required"],
    trim: true,
    maxlength: [255, "PDF name cannot exceed 255 characters"]
  },
  original_name: {
    type: String,
    required: true,
    trim: true
  },
  uuid: {
    type: String,
    required: [true, "PDF UUID is required"],
    unique: true,
    index: true
  },

  // File Properties
  size: {
    type: Number,
    required: [true, "File size is required"],
    min: [0, "File size cannot be negative"]
  },
  mime_type: {
    type: String,
    default: "application/pdf"
  },
  page_count: {
    type: Number,
    min: [0, "Page count cannot be negative"]
  },

  // Processing Status
  is_indexed: {
    type: Boolean,
    default: false,
    index: true
  },
  indexing_status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending"
  },
  indexed_at: {
    type: Date
  },

  // Content Information
  total_chunks: {
    type: Number,
    default: 0,
    min: [0, "Total chunks cannot be negative"]
  },
  successful_chunks: {
    type: Number,
    default: 0,
    min: [0, "Successful chunks cannot be negative"]
  },

  // User Association
  uploaded_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: [true, "User ID is required"],
    index: true
  },

  // Error Handling
  error_message: {
    type: String
  },

  // Metadata
  description: {
    type: String,
    maxlength: [500, "Description cannot exceed 500 characters"]
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [50, "Tag cannot exceed 50 characters"]
  }],

  // Vector DB info
  milvus_collection: {
    type: String,
    default: "RAG_TEXT_EMBEDDING"
  },

  // Access Control
  is_public: {
    type: Boolean,
    default: false
  },
  shared_with: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users'
    },
    permission: {
      type: String,
      enum: ["read", "write"],
      default: "read"
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
PdfSchema.index({ uploaded_by: 1, createdAt: -1 });
PdfSchema.index({ uuid: 1, uploaded_by: 1 });
PdfSchema.index({ is_indexed: 1, indexing_status: 1 });

// Virtual for human-readable file size
PdfSchema.virtual('size_mb').get(function () {
  return (this.size / (1024 * 1024)).toFixed(2);
});

// Instance method: Check if user has access
PdfSchema.methods.hasAccess = function (userId) {
  if (this.uploaded_by.toString() === userId.toString()) return true;
  if (this.is_public) return true;
  return this.shared_with.some(entry => entry.user.toString() === userId.toString());
};

// Static method: Get all PDFs a user can see
PdfSchema.statics.findByUser = function (userId, options = {}) {
  return this.find({
    $or: [
      { uploaded_by: userId },
      { is_public: true },
      { 'shared_with.user': userId }
    ]
  }, null, options);
};

// Pre-save middleware
PdfSchema.pre('save', function (next) {
  if (this.isModified('is_indexed') && this.is_indexed && !this.indexed_at) {
    this.indexed_at = new Date();
    this.indexing_status = 'completed';
  }
  if (!this.original_name && this.name) {
    this.original_name = this.name;
  }
  next();
});

PdfSchema.methods.getUserPermission = function(userId) {
  const userIdStr = userId.toString();
  const ownerIdStr = this.uploaded_by._id ? this.uploaded_by._id.toString() : this.uploaded_by.toString();
  
  // Owner has full access
  if (userIdStr === ownerIdStr) {
      return 'owner';
  }
  
  // Check if PDF is public
  if (this.is_public) {
      return 'read';
  }
  
  // Check shared permissions
  if (this.shared_with && this.shared_with.length > 0) {
      const userShare = this.shared_with.find(share => 
          share.user_id && share.user_id.toString() === userIdStr
      );
      if (userShare) {
          return userShare.permission || 'read';
      }
  }
  
  return 'none';
};

// Method to check if user has access
PdfSchema.methods.hasAccess = function(userId) {
  const permission = this.getUserPermission(userId);
  return permission !== 'none';
};


// Add this method to your PDFSModel schema

PdfSchema.methods.shareWith = function(userId, permission = 'read') {
  // Check if trying to share with owner
  if (this.uploaded_by.toString() === userId.toString()) {
      throw new Error('Cannot share PDF with owner');
  }

  // Initialize shared_with array if it doesn't exist
  if (!this.shared_with) {
      this.shared_with = [];
  }

  // Check if already shared with this user
  const existingShareIndex = this.shared_with.findIndex(
      share => share.user_id && share.user_id.toString() === userId.toString()
  );

  if (existingShareIndex >= 0) {
      // Update existing permission
      this.shared_with[existingShareIndex].permission = permission;
      this.shared_with[existingShareIndex].shared_at = new Date();
  } else {
      // Add new share
      this.shared_with.push({
          user_id: userId,
          permission: permission,
          shared_at: new Date()
      });
  }

  // Return the instance so you can chain .save()
  return this.save();
};

// Add this method to your PDFSModel schema

PdfSchema.methods.removeSharing = function(userId) {
  // Check if shared_with array exists
  if (!this.shared_with || this.shared_with.length === 0) {
      throw new Error('PDF is not shared with any users');
  }

  // Find the sharing entry
  const shareIndex = this.shared_with.findIndex(
      share => share.user_id && share.user_id.toString() === userId.toString()
  );

  if (shareIndex === -1) {
      throw new Error('PDF is not shared with this user');
  }

  // Remove the sharing entry
  this.shared_with.splice(shareIndex, 1);

  // Return the instance so you can chain .save()
  return this.save();
};

const PDFSModel = mongoose.model("pdfs", PdfSchema);
module.exports = PDFSModel;
